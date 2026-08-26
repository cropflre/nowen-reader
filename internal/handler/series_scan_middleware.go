package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

// rebuildSeriesAfterScan keeps the logical Series/Section projection in sync
// without extending the scan request with another full-library maintenance
// pass. The background worker coalesces duplicate notifications per library.
func rebuildSeriesAfterScan() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		status := c.Writer.Status()
		if status < http.StatusOK || status >= http.StatusMultipleChoices {
			return
		}
		service.ScheduleComicSeriesRebuild(c.Param("id"))
	}
}
