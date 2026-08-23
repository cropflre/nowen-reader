package store

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSerializedDBWriteCoordinatorAllowsOnlyOneWriter(t *testing.T) {
	const workers = 12
	start := make(chan struct{})
	var wg sync.WaitGroup
	var active atomic.Int64
	var peak atomic.Int64

	before := GetDBWriteCoordinatorStats().Executed
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if err := runSerializedDBWrite("test-single-writer", func() error {
				current := active.Add(1)
				for {
					seen := peak.Load()
					if current <= seen || peak.CompareAndSwap(seen, current) {
						break
					}
				}
				time.Sleep(3 * time.Millisecond)
				active.Add(-1)
				return nil
			}); err != nil {
				t.Errorf("serialized write failed: %v", err)
			}
		}()
	}

	close(start)
	wg.Wait()

	if got := peak.Load(); got != 1 {
		t.Fatalf("peak concurrent writers = %d, want 1", got)
	}
	if delta := GetDBWriteCoordinatorStats().Executed - before; delta < workers {
		t.Fatalf("executed delta = %d, want at least %d", delta, workers)
	}
}

func TestScannerMetadataWritesUseSerializedCoordinator(t *testing.T) {
	setupTestDB(t)
	if _, err := DB().Exec(`INSERT INTO "Comic" ("id", "filename", "title") VALUES ('writer-test', 'writer-test.cbz', 'writer test')`); err != nil {
		t.Fatal(err)
	}

	before := GetDBWriteCoordinatorStats().Executed
	const workers = 16
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if err := UpdateComicPageCount("writer-test", i+1); err != nil {
				t.Errorf("page-count update failed: %v", err)
			}
			if err := UpdateComicMD5Hash("writer-test", "hash"); err != nil {
				t.Errorf("md5 update failed: %v", err)
			}
		}(i)
	}
	wg.Wait()

	stats := GetDBWriteCoordinatorStats()
	if delta := stats.Executed - before; delta < workers*2 {
		t.Fatalf("serialized scanner writes delta = %d, want at least %d", delta, workers*2)
	}

	var pageCount int
	var md5Hash string
	if err := DB().QueryRow(`SELECT "pageCount", "md5Hash" FROM "Comic" WHERE "id" = 'writer-test'`).Scan(&pageCount, &md5Hash); err != nil {
		t.Fatal(err)
	}
	if pageCount <= 0 || md5Hash != "hash" {
		t.Fatalf("unexpected metadata after writes: pageCount=%d md5=%q", pageCount, md5Hash)
	}
}
