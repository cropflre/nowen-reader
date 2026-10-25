package handler

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// recordLibraryQuery exposes store/serialization-preparation time separately
// from the HTTP duration already recorded by request logging.
func recordLibraryQuery(c *gin.Context, name string, started time.Time, count, total int) {
	elapsed := time.Since(started)
	c.Writer.Header().Add("Server-Timing", fmt.Sprintf("%s;dur=%.2f", name, float64(elapsed.Microseconds())/1000))
	if elapsed >= 500*time.Millisecond {
		log.Printf("[library-performance] path=%s phase=%s elapsed_ms=%d returned=%d total=%d", c.Request.URL.Path, name, elapsed.Milliseconds(), count, total)
	}
}
