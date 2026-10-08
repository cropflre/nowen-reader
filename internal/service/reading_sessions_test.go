package service

import (
	"testing"
	"time"
)

func TestReadingLeasesAreIdempotentAndScoped(t *testing.T) {
	now := time.Now()
	s := &readingSessions{leases: make(map[readingSessionKey]readingLease), now: func() time.Time { return now }}
	a := readingSessionKey{"alice", "book", "tab-a"}
	b := readingSessionKey{"alice", "book", "tab-b"}
	c := readingSessionKey{"bob", "book", "tab-a"}
	d := readingSessionKey{"alice", "other-book", "tab-a"}
	for i := 0; i < 20; i++ {
		s.touch(a)
	}
	if len(s.leases) != 1 {
		t.Fatal("warmups multiplied the lease")
	}
	for _, key := range []readingSessionKey{b, c, d} {
		s.touch(key)
	}
	s.end(a)
	s.end(a)
	if s.touch(a) {
		t.Fatal("late heartbeat reopened ended session")
	}
	if !s.active() {
		t.Fatal("other readers were released")
	}
	s.end(b)
	s.end(c)
	if !s.active() {
		t.Fatal("another book was released")
	}
	s.end(d)
	if s.active() {
		t.Fatal("ended leases still pause scanning")
	}
}

func TestReadingLeaseExpiryAndRenewal(t *testing.T) {
	now := time.Now()
	s := &readingSessions{leases: make(map[readingSessionKey]readingLease), now: func() time.Time { return now }}
	key := readingSessionKey{"alice", "book", "tab"}
	s.touch(key)
	now = now.Add(ReadingSessionTTL - time.Second)
	if !s.active() {
		t.Fatal("lease expired early")
	}
	s.touch(key)
	now = now.Add(ReadingSessionTTL - time.Second)
	if !s.active() {
		t.Fatal("heartbeat failed to renew")
	}
	now = now.Add(time.Second)
	if s.active() || len(s.leases) != 0 {
		t.Fatal("crashed reader permanently pauses scanning")
	}
	legacy := readingSessionKey{"alice", "book", ""}
	s.touch(legacy)
	s.end(legacy)
	if !s.touch(legacy) {
		t.Fatal("legacy reader cannot reopen")
	}
}
