package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

type PluginHandler struct{}

func NewPluginHandler() *PluginHandler { return &PluginHandler{} }

// GET /api/plugins
func (h *PluginHandler) List(c *gin.Context) {
	plugins := service.GetPlugins()
	if plugins == nil {
		plugins = []service.PluginInfo{}
	}
	c.JSON(200, gin.H{"plugins": plugins})
}

// POST /api/plugins
func (h *PluginHandler) Action(c *gin.Context) {
	var body struct {
		Action   string                 `json:"action"`   // "toggle" or "settings"
		PluginID string                 `json:"pluginId"`
		Enabled  *bool                  `json:"enabled"`
		Settings map[string]interface{} `json:"settings"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"error": "invalid request body"})
		return
	}

	switch body.Action {
	case "toggle":
		if body.PluginID == "" || body.Enabled == nil {
			c.JSON(400, gin.H{"error": "pluginId and enabled are required"})
			return
		}
		ok := service.SetPluginEnabled(body.PluginID, *body.Enabled)
		if !ok {
			c.JSON(404, gin.H{"error": "Plugin not found"})
			return
		}
		c.JSON(200, gin.H{"success": true})

	case "settings":
		if body.PluginID == "" || body.Settings == nil {
			c.JSON(400, gin.H{"error": "pluginId and settings are required"})
			return
		}
		ok := service.UpdatePluginSettings(body.PluginID, body.Settings)
		if !ok {
			c.JSON(404, gin.H{"error": "Plugin not found"})
			return
		}
		c.JSON(200, gin.H{"success": true})

	default:
		c.JSON(400, gin.H{"error": "Unknown action. Use: toggle, settings"})
	}
}
