package service

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func waitScannerJobState(t *testing.T, c *scannerJobCoordinator, id string, state ScannerJobState) ScannerJobSnapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := c.get(id); ok && job.State == state {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	job, _ := c.get(id)
	t.Fatalf("job %s did not reach %s; final=%+v", id, state, job)
	return ScannerJobSnapshot{}
}

func TestScannerJobCoordinatorDeduplicatesActiveLibraryJob(t *testing.T) {
	release := make(chan struct{})
	c := newScannerJobCoordinator(func(job *scannerJob) (SyncResult, error) {
		<-release
		return SyncResult{Added: 3}, nil
	})

	first, created := c.enqueue(ScannerJobLibrary, "library:books", "books", "manual", 100, false)
	if !created {
		t.Fatal("first job unexpectedly deduplicated")
	}
	waitScannerJobState(t, c, first.ID, ScannerJobRunning)

	second, created := c.enqueue(ScannerJobLibrary, "library:books", "books", "manual", 100, false)
	if created {
		t.Fatal("duplicate active library job was queued")
	}
	if second.ID != first.ID {
		t.Fatalf("deduplicated job id = %s, want %s", second.ID, first.ID)
	}

	close(release)
	completed := waitScannerJobState(t, c, first.ID, ScannerJobCompleted)
	if completed.Added != 3 {
		t.Fatalf("completed Added = %d, want 3", completed.Added)
	}
}

func TestScannerJobCoordinatorExposesFailureAndPartialCounts(t *testing.T) {
	c := newScannerJobCoordinator(func(job *scannerJob) (SyncResult, error) {
		return SyncResult{Added: 7, Removed: 2}, errors.New("database write failed")
	})

	job, created := c.enqueue(ScannerJobQuick, "quick", "", "test", 50, false)
	if !created {
		t.Fatal("job unexpectedly deduplicated")
	}
	failed := waitScannerJobState(t, c, job.ID, ScannerJobFailed)
	if failed.Added != 7 || failed.Removed != 2 {
		t.Fatalf("partial counts = %d/%d, want 7/2", failed.Added, failed.Removed)
	}
	if !strings.Contains(failed.Error, "database write failed") {
		t.Fatalf("failure not exposed: %q", failed.Error)
	}
}
