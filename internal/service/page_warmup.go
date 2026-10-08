package service

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/nowen-reader/nowen-reader/internal/archive"
)

type pageWarmupJob struct{ pending map[int]bool }
type pageWarmupQueue struct {
	mu    sync.Mutex
	jobs  map[string]*pageWarmupJob
	ready chan string
	run   func(string, []int)
}

func newPageWarmupQueue(run func(string, []int)) *pageWarmupQueue {
	return &pageWarmupQueue{jobs: make(map[string]*pageWarmupJob), ready: make(chan string, 32), run: run}
}

var readerWarmups = newPageWarmupQueue(warmReaderPages)

func init() { go readerWarmups.work() }

// WarmupPages merges pending ranges for a book. A single bounded background
// worker prevents overlapping requests from multiplying disk/CPU work.
func WarmupPages(comicID string, startPage, count int) {
	readerWarmups.enqueue(comicID, startPage, count)
}

func (q *pageWarmupQueue) enqueue(comicID string, start, count int) {
	if start < 0 || count <= 0 {
		return
	}
	if count > 30 {
		count = 30
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	job := q.jobs[comicID]
	if job == nil {
		if len(q.jobs) >= cap(q.ready) {
			return // Speculative work can be skipped; foreground requests still work.
		}
		job = &pageWarmupJob{pending: make(map[int]bool)}
		q.jobs[comicID] = job
		q.ready <- comicID
	}
	for i := 0; i < count && len(job.pending) < 64; i++ {
		job.pending[start+i] = true
	}
}

func (q *pageWarmupQueue) work() {
	for comicID := range q.ready {
		q.mu.Lock()
		job := q.jobs[comicID]
		pages := make([]int, 0, len(job.pending))
		for page := range job.pending {
			pages = append(pages, page)
		}
		job.pending = make(map[int]bool)
		q.mu.Unlock()
		sort.Ints(pages)
		q.run(comicID, pages)
		q.mu.Lock()
		if len(job.pending) == 0 {
			delete(q.jobs, comicID)
		} else {
			q.ready <- comicID
		}
		q.mu.Unlock()
	}
}

func warmReaderPages(comicID string, requested []int) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return
	}
	info, err := os.Stat(fp)
	if err != nil || info.IsDir() {
		return
	}
	pages, err := GetComicPagesEx(comicID)
	if err != nil || pages.IsNovel {
		return
	}
	dir := readerCacheDir(comicID, fp, info)
	missing := make([]int, 0, len(requested))
	for _, page := range requested {
		if page >= 0 && page < len(pages.Entries) && cachedPageFile(dir, page) == nil {
			missing = append(missing, page)
		}
	}
	if len(missing) == 0 {
		return
	}
	kind := archive.DetectType(fp)
	if kind != archive.TypeRar && kind != archive.Type7z {
		for _, page := range missing {
			if _, err := GetPageFile(comicID, page); err != nil {
				log.Printf("[warmup] %s page %d: %v", comicID, page, err)
			}
		}
		return
	}
	pageExtractSlots <- struct{}{}
	defer func() { <-pageExtractSlots }()
	reader, err := getPooledReader(fp)
	if err != nil {
		return
	}
	calls := make(map[int]*pageFileCall)
	names := make(map[string]int)
	for _, page := range missing {
		if cachedPageFile(dir, page) != nil {
			continue
		}
		call, owner := reservePageFile(pageFileKey(dir, page))
		if owner {
			calls[page] = call
			names[pages.Entries[page]] = page
		}
	}
	if len(calls) == 0 {
		return
	}
	err = archive.ExtractImageBatch(reader, names, func(page int, name string, data []byte) error {
		file, writeErr := writePageFile(dir, page, strings.ToLower(filepath.Ext(name)), data)
		finishPageFile(pageFileKey(dir, page), calls[page], file, writeErr)
		delete(calls, page)
		return writeErr
	})
	if err == nil && len(calls) > 0 {
		err = fmt.Errorf("batch did not produce all requested pages")
	}
	for page, call := range calls {
		finishPageFile(pageFileKey(dir, page), call, nil, err)
	}
	if err != nil {
		log.Printf("[warmup] batch %s: %v", comicID, err)
	}
}
