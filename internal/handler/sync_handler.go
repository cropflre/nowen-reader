package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

type SyncHandler struct{}

func NewSyncHandler() *SyncHandler { return &SyncHandler{} }

// GET /api/cloud-sync — export local data
func (h *SyncHandler) Export(c *gin.Context) {
	deviceID := c.DefaultQuery("deviceId", "go-server")
	data, err := service.ExportSyncData(deviceID)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to export sync data"})
		return
	}
	c.JSON(200, data)
}

// POST /api/cloud-sync — import or WebDAV sync
func (h *SyncHandler) Sync(c *gin.Context) {
	var body struct {
		Action   string              `json:"action"` // "webdav-sync" | "import" | "test-connection"
		Config   service.SyncConfig  `json:"config"`
		Data     *service.SyncData   `json:"data"`
		DeviceID string              `json:"deviceId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}

	if body.DeviceID == "" {
		body.DeviceID = "go-server"
	}

	switch body.Action {
	case "webdav-sync":
		result := service.PerformWebDAVSync(body.Config, body.DeviceID)
		c.JSON(200, result)

	case "import":
		if body.Data == nil {
			c.JSON(400, gin.H{"error": "data is required for import"})
			return
		}
		result, err := service.ImportSyncData(body.Data)
		if err != nil {
			c.JSON(500, gin.H{"error": "Failed to import sync data"})
			return
		}
		c.JSON(200, gin.H{
			"success":   true,
			"updated":   result.Updated,
			"skipped":   result.Skipped,
			"conflicts": result.Conflicts,
		})

	case "test-connection":
		if body.Config.WebDAVURL == "" || body.Config.WebDAVUsername == "" {
			c.JSON(400, gin.H{"error": "WebDAV URL and username required"})
			return
		}
		client := service.NewWebDAVClient(body.Config.WebDAVURL, body.Config.WebDAVUsername, body.Config.WebDAVPassword)
		connected := client.TestConnection()
		c.JSON(200, gin.H{"connected": connected})

	default:
		c.JSON(400, gin.H{"error": "Unknown action. Use: webdav-sync, import, test-connection"})
	}
}
