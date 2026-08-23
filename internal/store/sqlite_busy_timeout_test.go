package store

import (
	"context"
	"testing"
)

func TestSQLiteBusyTimeoutAppliesToEveryPooledConnection(t *testing.T) {
	setupTestDB(t)

	ctx := context.Background()
	conns := make([]interface{ Close() error }, 0, 4)
	for i := 0; i < 4; i++ {
		conn, err := DB().Conn(ctx)
		if err != nil {
			t.Fatalf("open pooled connection %d: %v", i, err)
		}
		conns = append(conns, conn)

		var timeout int
		if err := conn.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&timeout); err != nil {
			t.Fatalf("read busy_timeout on connection %d: %v", i, err)
		}
		if timeout != 30000 {
			t.Fatalf("connection %d busy_timeout=%d, want 30000", i, timeout)
		}
	}
	for _, conn := range conns {
		_ = conn.Close()
	}
}
