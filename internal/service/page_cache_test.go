package service

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestPageCacheAtomicPublishRestartAndSourceVersion(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".page-aborted.tmp"), []byte("partial"), 0644); err != nil {
		t.Fatal(err)
	}
	if cachedPageFile(dir, 0) != nil {
		t.Fatal("partial write was visible")
	}
	data := bytes.Repeat([]byte("page"), 1024)
	file, err := writePageFile(dir, 0, ".png", data)
	if err != nil {
		t.Fatal(err)
	}
	firstTag := file.ETag
	invalidatePageIndexes()
	file = cachedPageFile(dir, 0)
	if file == nil || file.ETag != firstTag {
		t.Fatal("disk cache did not survive index restart")
	}
	got, err := os.ReadFile(file.Path)
	if err != nil || !bytes.Equal(data, got) {
		t.Fatal("cached bytes changed")
	}
	source := filepath.Join(t.TempDir(), "book.cbz")
	if err := os.WriteFile(source, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	oldInfo, _ := os.Stat(source)
	oldDir := readerCacheDir("book", source, oldInfo)
	if err := os.Chtimes(source, oldInfo.ModTime().Add(time.Nanosecond), oldInfo.ModTime().Add(time.Nanosecond)); err != nil {
		t.Fatal(err)
	}
	newInfo, _ := os.Stat(source)
	if oldDir == readerCacheDir("book", source, newInfo) {
		t.Fatal("same-size source replacement reused stale version")
	}
	if err := os.Remove(file.Path); err != nil {
		t.Fatal(err)
	}
	if cachedPageFile(dir, 0) != nil {
		t.Fatal("deleted cache entry was still served")
	}
}

func TestPageRequestsShareInFlightExtraction(t *testing.T) {
	key := filepath.Join(t.TempDir(), "page")
	owner, first := reservePageFile(key)
	if !first {
		t.Fatal("no owner")
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		call, owns := reservePageFile(key)
		if owns || call != owner {
			t.Fatal("duplicate extraction")
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-call.done
			if call.file == nil || call.err != nil {
				t.Error("waiter lost result")
			}
		}()
	}
	finishPageFile(key, owner, &PageFile{Path: key}, nil)
	wg.Wait()
}

func TestWarmupQueueMergesRangesAndBoundsPendingWork(t *testing.T) {
	runs := make(chan []int, 2)
	proceed := make(chan struct{})
	q := newPageWarmupQueue(func(_ string, pages []int) { runs <- pages; <-proceed })
	q.enqueue("book", 0, 8)
	q.enqueue("book", 4, 8)
	go q.work()
	if got := <-runs; !reflect.DeepEqual(got, []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}) {
		t.Fatalf("overlap was not merged: %v", got)
	}
	q.enqueue("book", 12, 8)
	q.enqueue("book", 16, 8)
	proceed <- struct{}{}
	if got := <-runs; !reflect.DeepEqual(got, []int{12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}) {
		t.Fatalf("running job lost followup: %v", got)
	}
	close(q.ready)
	proceed <- struct{}{}
	bounded := newPageWarmupQueue(func(string, []int) {})
	for i := 0; i < 10; i++ {
		bounded.enqueue("book", i*30, 100000)
	}
	if len(bounded.jobs["book"].pending) > 64 {
		t.Fatal("unbounded page work")
	}
	for i := 0; i < 100; i++ {
		bounded.enqueue(string(rune(i+65)), 0, 8)
	}
	if len(bounded.jobs) > cap(bounded.ready) {
		t.Fatal("unbounded book work")
	}
}
