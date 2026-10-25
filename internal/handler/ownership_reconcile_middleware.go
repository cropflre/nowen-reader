package handler

import (
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

var (
	ownershipReconcileMu          sync.Mutex
	ownershipReconcileLastAttempt time.Time
	ownershipInitialCheckDone     bool
)

// reconcileOwnershipBeforeList repairs historical duplicate rows before the
// first shelf response. If a background scan is busy, the check is throttled
// and retried by a later request.
func reconcileOwnershipBeforeList() gin.HandlerFunc {
	return func(c *gin.Context) {
		reconcileOwnershipIfDue("list", 15*time.Second, true)
		c.Next()
	}
}

// reconcileOwnershipAfterScan merges parent/child-library duplicates after a
// successful manual or upload-triggered scan, before the client refetches.
func reconcileOwnershipAfterScan() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		status := c.Writer.Status()
		if status >= http.StatusOK && status < http.StatusMultipleChoices {
			reconcileOwnershipIfDue("scan", 0, false)
		}
	}
}

func reconcileOwnershipIfDue(reason string, minInterval time.Duration, initialOnly bool) {
	if initialOnly {
		// A scan/reconciliation already in progress must not stall list reads.
		if !ownershipReconcileMu.TryLock() {
			return
		}
	} else {
		ownershipReconcileMu.Lock()
	}
	defer ownershipReconcileMu.Unlock()

	if initialOnly && ownershipInitialCheckDone {
		return
	}
	now := time.Now()
	if minInterval > 0 && !ownershipReconcileLastAttempt.IsZero() && now.Sub(ownershipReconcileLastAttempt) < minInterval {
		return
	}
	ownershipReconcileLastAttempt = now

	preview, err := service.PreviewLibraryOwnership()
	if err != nil {
		log.Printf("[ownership] automatic preview after %s failed: %v", reason, err)
		return
	}
	if preview == nil || preview.IssueCount == 0 {
		ownershipInitialCheckDone = true
		return
	}
	if !preview.CanReconcile {
		ownershipInitialCheckDone = true
		// Exact-root conflicts still require an explicit administrator choice;
		// parent/child duplicate rows remain safe to repair automatically.
		log.Printf("[ownership] automatic reconciliation after %s skipped: %d unresolved root conflict(s)", reason, len(preview.RootConflicts))
		return
	}

	result, err := service.ReconcileLibraryOwnership()
	if err != nil {
		// Background scans are expected to win the synchronization lock. A later
		// list or scan request will retry without surfacing an error to the user.
		if !strings.Contains(err.Error(), "scan is already running") && !strings.Contains(err.Error(), "sync is already running") {
			log.Printf("[ownership] automatic reconciliation after %s failed: %v", reason, err)
		}
		return
	}
	ownershipInitialCheckDone = true
	if result != nil && (result.MergedRows > 0 || result.MovedRows > 0) {
		log.Printf("[ownership] automatic reconciliation after %s: merged=%d moved=%d", reason, result.MergedRows, result.MovedRows)
	}
}

// InitializeShelfMaintenance performs legacy repairs before accepting requests.
// Scans retain their reconciliation hooks; list middleware is a retry fallback.
func InitializeShelfMaintenance() {
	reconcileOwnershipIfDue("startup", 0, true)
	if err := service.EnsureComicSeriesFresh(); err != nil {
		log.Printf("[series] startup refresh failed: %v", err)
	}
}
