package service

import (
	"sync"
	"time"
)

const ReadingSessionTTL = 2 * time.Minute

type readingSessionKey struct{ owner, comic, client string }
type readingLease struct {
	expires time.Time
	ended   bool
}
type readingSessions struct {
	mu     sync.Mutex
	leases map[readingSessionKey]readingLease
	now    func() time.Time
}

var readerSessions = &readingSessions{leases: make(map[readingSessionKey]readingLease), now: time.Now}

func init() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			readerSessions.active()
		}
	}()
}

func (s *readingSessions) prune(now time.Time) {
	for key, lease := range s.leases {
		if !now.Before(lease.expires) {
			delete(s.leases, key)
		}
	}
}

func (s *readingSessions) touch(key readingSessionKey) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.prune(now)
	if s.leases[key].ended {
		return false // Ignore a heartbeat that arrived after the close request.
	}
	s.leases[key] = readingLease{expires: now.Add(ReadingSessionTTL)}
	return true
}

func (s *readingSessions) end(key readingSessionKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	s.prune(now)
	if key.client == "" {
		// Older clients reuse the same implicit session on reopening a book.
		delete(s.leases, key)
		return
	}
	s.leases[key] = readingLease{expires: now.Add(ReadingSessionTTL), ended: true}
}

func (s *readingSessions) active() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(s.now())
	for _, lease := range s.leases {
		if !lease.ended {
			return true
		}
	}
	return false
}

// TouchReadingSession renews one owner-scoped lease, rather than incrementing
// a global counter on every prefetch request. Empty IDs support older clients.
func TouchReadingSession(owner, comicID, clientID string) bool {
	return readerSessions.touch(readingSessionKey{owner, comicID, clientID})
}

func EndReadingSession(owner, comicID, clientID string) {
	readerSessions.end(readingSessionKey{owner, comicID, clientID})
}

func isReadingActive() bool { return readerSessions.active() }
