package store

import (
	"fmt"
	"testing"
)

func TestRunSerializedDBWriteRetriesSQLiteBusySnapshot(t *testing.T) {
	attempts := 0
	err := runSerializedDBWrite("retry-test", func() error {
		attempts++
		if attempts < 3 {
			return fmt.Errorf("database is locked (517)")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected transient lock to recover, got %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestRunSerializedDBWriteDoesNotRetryPermanentError(t *testing.T) {
	attempts := 0
	err := runSerializedDBWrite("permanent-error-test", func() error {
		attempts++
		return fmt.Errorf("constraint failed")
	})
	if err == nil {
		t.Fatal("expected permanent error")
	}
	if attempts != 1 {
		t.Fatalf("expected permanent error to run once, got %d attempts", attempts)
	}
}

func TestIsRetryableSQLiteWriteError(t *testing.T) {
	cases := []string{
		"database is locked (5)",
		"database is locked (517)",
		"SQLITE_BUSY",
		"SQLITE_LOCKED",
		"database table is locked",
	}
	for _, msg := range cases {
		if !isRetryableSQLiteWriteError(fmt.Errorf("%s", msg)) {
			t.Fatalf("expected retryable error: %s", msg)
		}
	}
	if isRetryableSQLiteWriteError(fmt.Errorf("constraint failed")) {
		t.Fatal("constraint errors must not be retried")
	}
}
