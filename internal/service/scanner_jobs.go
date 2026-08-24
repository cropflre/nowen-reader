package service

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

type ScannerJobKind string

type ScannerJobState string

const (
	ScannerJobQuick       ScannerJobKind = "quick"
	ScannerJobForce       ScannerJobKind = "force"
	ScannerJobLibrary     ScannerJobKind = "library"
	ScannerJobMaintenance ScannerJobKind = "maintenance"
	ScannerJobRedetect    ScannerJobKind = "redetect"

	ScannerJobQueued    ScannerJobState = "queued"
	ScannerJobRunning   ScannerJobState = "running"
	ScannerJobCompleted ScannerJobState = "completed"
	ScannerJobFailed    ScannerJobState = "failed"
)

const scannerJobHistoryLimit = 200

type ScannerJobSnapshot struct {
	ID         string          `json:"id"`
	Kind       ScannerJobKind  `json:"kind"`
	LibraryID  string          `json:"libraryId,omitempty"`
	State      ScannerJobState `json:"state"`
	Reason     string          `json:"reason,omitempty"`
	QueuedAt   time.Time       `json:"queuedAt"`
	StartedAt  *time.Time      `json:"startedAt,omitempty"`
	FinishedAt *time.Time      `json:"finishedAt,omitempty"`
	Added      int             `json:"added"`
	Removed    int             `json:"removed"`
	Moved      int             `json:"moved"`
	TypeFixed  int             `json:"typeFixed"`
	Error      string          `json:"error,omitempty"`
}

type scannerJob struct {
	ScannerJobSnapshot
	key      string
	priority int
	force    bool
	sequence uint64
}

type scannerJobCoordinator struct {
	mu          sync.Mutex
	cond        *sync.Cond
	queue       []*scannerJob
	jobs        map[string]*scannerJob
	activeByKey map[string]string
	completed   []string
	sequence    uint64
	started     bool
	executor    func(*scannerJob) (SyncResult, error)
}

func newScannerJobCoordinator(executor func(*scannerJob) (SyncResult, error)) *scannerJobCoordinator {
	c := &scannerJobCoordinator{
		jobs:        make(map[string]*scannerJob),
		activeByKey: make(map[string]string),
		executor:    executor,
	}
	c.cond = sync.NewCond(&c.mu)
	return c
}

var scannerJobs = newScannerJobCoordinator(executeScannerJob)

func (c *scannerJobCoordinator) start() {
	c.mu.Lock()
	if c.started {
		c.mu.Unlock()
		return
	}
	c.started = true
	c.mu.Unlock()
	go c.worker()
}

func (c *scannerJobCoordinator) enqueue(kind ScannerJobKind, key, libraryID, reason string, priority int, force bool) (ScannerJobSnapshot, bool) {
	c.start()
	c.mu.Lock()
	defer c.mu.Unlock()

	if activeID, ok := c.activeByKey[key]; ok {
		if active := c.jobs[activeID]; active != nil {
			// A filesystem-triggered quick sync upgrades a queued periodic quick
			// sync so the cooldown/directory checks cannot suppress a real change.
			if active.State == ScannerJobQueued && force {
				active.force = true
			}
			return active.ScannerJobSnapshot, false
		}
	}

	c.sequence++
	now := time.Now().UTC()
	job := &scannerJob{
		ScannerJobSnapshot: ScannerJobSnapshot{
			ID:        fmt.Sprintf("scan-%d-%d", now.UnixNano(), c.sequence),
			Kind:      kind,
			LibraryID: libraryID,
			State:     ScannerJobQueued,
			Reason:    reason,
			QueuedAt:  now,
		},
		key:      key,
		priority: priority,
		force:    force,
		sequence: c.sequence,
	}
	c.jobs[job.ID] = job
	c.activeByKey[key] = job.ID
	c.queue = append(c.queue, job)
	sort.SliceStable(c.queue, func(i, j int) bool {
		if c.queue[i].priority == c.queue[j].priority {
			return c.queue[i].sequence < c.queue[j].sequence
		}
		return c.queue[i].priority > c.queue[j].priority
	})
	c.cond.Signal()
	return job.ScannerJobSnapshot, true
}

func (c *scannerJobCoordinator) get(id string) (ScannerJobSnapshot, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	job, ok := c.jobs[id]
	if !ok || job == nil {
		return ScannerJobSnapshot{}, false
	}
	return job.ScannerJobSnapshot, true
}

func (c *scannerJobCoordinator) recent(limit int) []ScannerJobSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	result := make([]ScannerJobSnapshot, 0, limit)
	// Active/queued jobs first.
	for _, job := range c.jobs {
		if job.State == ScannerJobQueued || job.State == ScannerJobRunning {
			result = append(result, job.ScannerJobSnapshot)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].QueuedAt.After(result[j].QueuedAt) })
	for i := len(c.completed) - 1; i >= 0 && len(result) < limit; i-- {
		if job := c.jobs[c.completed[i]]; job != nil {
			result = append(result, job.ScannerJobSnapshot)
		}
	}
	if len(result) > limit {
		result = result[:limit]
	}
	return result
}

func (c *scannerJobCoordinator) worker() {
	for {
		c.mu.Lock()
		for len(c.queue) == 0 {
			c.cond.Wait()
		}
		job := c.queue[0]
		c.queue = c.queue[1:]
		now := time.Now().UTC()
		job.State = ScannerJobRunning
		job.StartedAt = &now
		c.mu.Unlock()

		result, err := func() (result SyncResult, err error) {
			defer func() {
				if recovered := recover(); recovered != nil {
					err = fmt.Errorf("scanner job panic: %v", recovered)
				}
			}()
			return c.executor(job)
		}()

		c.mu.Lock()
		finished := time.Now().UTC()
		job.FinishedAt = &finished
		job.Added = result.Added
		job.Removed = result.Removed
		job.Moved = result.Moved
		job.TypeFixed = result.TypeFixed
		if err != nil {
			job.State = ScannerJobFailed
			job.Error = err.Error()
			log.Printf("[scanner-job] %s %s failed: %v", job.Kind, job.ID, err)
		} else {
			job.State = ScannerJobCompleted
			log.Printf("[scanner-job] %s %s completed: added=%d removed=%d", job.Kind, job.ID, result.Added, result.Removed)
		}
		delete(c.activeByKey, job.key)
		c.completed = append(c.completed, job.ID)
		for len(c.completed) > scannerJobHistoryLimit {
			oldest := c.completed[0]
			c.completed = c.completed[1:]
			delete(c.jobs, oldest)
		}
		c.mu.Unlock()
	}
}

func QueueLibraryScan(libraryID string) (ScannerJobSnapshot, bool) {
	return scannerJobs.enqueue(ScannerJobLibrary, "library:"+libraryID, libraryID, "manual", 100, false)
}

func QueueForceSync(reason string) (ScannerJobSnapshot, bool) {
	return scannerJobs.enqueue(ScannerJobForce, "force", "", reason, 90, true)
}

func QueueRedetect(reason string) (ScannerJobSnapshot, bool) {
	return scannerJobs.enqueue(ScannerJobRedetect, "redetect", "", reason, 70, true)
}

func queueQuickSync(reason string, bypassCooldown bool) (ScannerJobSnapshot, bool) {
	return scannerJobs.enqueue(ScannerJobQuick, "quick", "", reason, 50, bypassCooldown)
}

func queueMaintenance(reason string) (ScannerJobSnapshot, bool) {
	return scannerJobs.enqueue(ScannerJobMaintenance, "maintenance", "", reason, 10, false)
}

func GetScannerJob(id string) (ScannerJobSnapshot, bool) {
	return scannerJobs.get(id)
}

func RecentScannerJobs(limit int) []ScannerJobSnapshot {
	return scannerJobs.recent(limit)
}

func executeScannerJob(job *scannerJob) (SyncResult, error) {
	switch job.Kind {
	case ScannerJobLibrary:
		added, removed, err := SyncLibraryByID(job.LibraryID)
		result := SyncResult{Added: added, Removed: removed}
		if err != nil {
			return result, err
		}
		if err := RebuildComicSeriesForLibrary(job.LibraryID); err != nil {
			return result, fmt.Errorf("rebuild library series: %w", err)
		}
		reconcileOwnershipAfterScannerJob("library:" + job.LibraryID)
		return result, nil

	case ScannerJobQuick, ScannerJobForce:
		result, err := executeStrictQuickJob(job.force || job.Kind == ScannerJobForce)
		if err != nil {
			return result, err
		}
		if result.Added > 0 || result.Removed > 0 || job.Kind == ScannerJobForce {
			if err := RebuildAllComicSeries(); err != nil {
				return result, fmt.Errorf("rebuild series after quick sync: %w", err)
			}
		}
		reconcileOwnershipAfterScannerJob(string(job.Kind))
		return result, nil

	case ScannerJobMaintenance:
		if isReadingActive() {
			log.Println("[scanner-job] maintenance skipped: active reading session")
			return SyncResult{}, nil
		}
		if err := acquireLegacyScannerGuard(); err != nil {
			return SyncResult{}, err
		}
		defer releaseLegacyScannerGuard()
		fullSync()
		md5Sync()
		return SyncResult{}, nil

	case ScannerJobRedetect:
		if err := acquireLegacyScannerGuard(); err != nil {
			return SyncResult{}, err
		}
		reclassified := RedetectEbookTypes()
		releaseLegacyScannerGuard()
		InvalidateAllCaches()
		if err := RebuildAllComicSeries(); err != nil {
			return SyncResult{TypeFixed: reclassified}, err
		}
		return SyncResult{TypeFixed: reclassified}, nil
	default:
		return SyncResult{}, fmt.Errorf("unknown scanner job kind %q", job.Kind)
	}
}

func executeStrictQuickJob(force bool) (SyncResult, error) {
	if err := acquireLegacyScannerGuard(); err != nil {
		return SyncResult{}, err
	}
	guardHeld := true
	defer func() {
		if guardHeld {
			releaseLegacyScannerGuard()
		}
	}()

	now := time.Now()
	if !force {
		syncMu.Lock()
		if now.Sub(lastSyncTime) < getScannerCooldown() {
			syncMu.Unlock()
			releaseLegacyScannerGuard()
			guardHeld = false
			return SyncResult{}, nil
		}
		lastWasZero := lastSyncTime.IsZero()
		syncMu.Unlock()

		if !lastWasZero && !directoriesChanged() {
			syncMu.Lock()
			lastSyncTime = now
			syncMu.Unlock()
			releaseLegacyScannerGuard()
			guardHeld = false
			return SyncResult{}, nil
		}
	}

	syncMu.Lock()
	lastSyncTime = now
	syncMu.Unlock()

	repairMisclassifiedFolderComics()
	added, removed, err := strictQuickSync()
	result := SyncResult{Added: added, Removed: removed}
	if err != nil {
		return result, err
	}

	// Only advance the directory snapshot after every required database write
	// completed successfully. A failed scan must be retried, not hidden by mtime.
	updateDirMtimes()

	if added > 0 {
		if created, groupErr := store.AutoGroupByDirectory(); groupErr != nil {
			log.Printf("[scanner-job] auto grouping warning: %v", groupErr)
		} else if created > 0 {
			log.Printf("[scanner-job] auto-created %d series", created)
		}
		RunScanRulesForNewlyAdded()
	}

	// Keep redetection inside the same serialized scanner task so it cannot race
	// with a manual library scan or the periodic maintenance job.
	result.TypeFixed += RedetectEbookTypes()
	if force || added > 0 || removed > 0 || result.TypeFixed > 0 {
		InvalidateAllCaches()
		result.CacheCleared = true
	}

	releaseLegacyScannerGuard()
	guardHeld = false
	return result, nil
}

func acquireLegacyScannerGuard() error {
	syncMu.Lock()
	defer syncMu.Unlock()
	if syncInProgress {
		return fmt.Errorf("legacy scanner operation is already running")
	}
	syncInProgress = true
	return nil
}

func releaseLegacyScannerGuard() {
	syncMu.Lock()
	syncInProgress = false
	syncMu.Unlock()
}

func reconcileOwnershipAfterScannerJob(reason string) {
	preview, err := PreviewLibraryOwnership()
	if err != nil {
		log.Printf("[scanner-job] ownership preview after %s failed: %v", reason, err)
		return
	}
	if preview == nil || preview.IssueCount == 0 || !preview.CanReconcile {
		return
	}
	result, err := ReconcileLibraryOwnership()
	if err != nil {
		log.Printf("[scanner-job] ownership reconcile after %s failed: %v", reason, err)
		return
	}
	if result != nil && (result.MergedRows > 0 || result.MovedRows > 0) {
		log.Printf("[scanner-job] ownership reconciled after %s: merged=%d moved=%d", reason, result.MergedRows, result.MovedRows)
	}
}

// StartBackgroundSyncV2 replaces the legacy independent goroutines with one
// queue. File parsing/hashing remains internally concurrent, while quick/full/
// md5/manual-library work cannot overlap as top-level scanner jobs.
func StartBackgroundSyncV2() {
	bgSyncMu.Lock()
	defer bgSyncMu.Unlock()
	if bgSyncStarted {
		return
	}
	bgSyncStarted = true
	scannerJobs.start()

	queueQuickSync("startup", true)
	go startFSWatcherV2()

	go func() {
		ticker := time.NewTicker(getQuickSyncInterval())
		defer ticker.Stop()
		for range ticker.C {
			queueQuickSync("periodic", false)
		}
	}()

	go func() {
		time.Sleep(5 * time.Second)
		ticker := time.NewTicker(getFullSyncInterval())
		defer ticker.Stop()
		for range ticker.C {
			queueMaintenance("periodic")
		}
	}()

	log.Println("[scanner-job] background scheduler started (unified queue + fsnotify + polling)")
}

func startFSWatcherV2() {
	fsWatcherMu.Lock()
	defer fsWatcherMu.Unlock()
	if fsWatcher != nil {
		return
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("[scanner-job] failed to create fsnotify watcher: %v (polling remains active)", err)
		return
	}
	fsWatcher = watcher

	for _, dir := range getAllLibraryRootPaths() {
		if _, err := os.Stat(dir); err == nil {
			watchDirectoriesRecursive(watcher, dir)
			log.Printf("[scanner-job] watching directory: %s", dir)
		}
	}

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Op&(fsnotify.Create|fsnotify.Remove|fsnotify.Rename) == 0 {
					continue
				}
				if event.Op&fsnotify.Create != 0 {
					if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
						watchDirectoriesRecursive(watcher, event.Name)
					}
				}
				name := filepath.Base(event.Name)
				if config.IsSupportedFile(name) || config.IsImageFile(name) {
					triggerQueuedQuickSync()
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("[scanner-job] fsnotify error: %v", err)
			}
		}
	}()
}

func triggerQueuedQuickSync() {
	fsDebounceMu.Lock()
	defer fsDebounceMu.Unlock()
	if fsDebounceTicker != nil {
		fsDebounceTicker.Stop()
	}
	fsDebounceTicker = time.AfterFunc(getFSDebounceDelay(), func() {
		queueQuickSync("fsnotify", true)
	})
}
