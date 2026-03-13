package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

// ============================================================
// Plugin Types
// ============================================================

type PluginManifest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Description string   `json:"description"`
	Author      string   `json:"author"`
	Homepage    string   `json:"homepage,omitempty"`
	Permissions []string `json:"permissions,omitempty"`
	Hooks       []string `json:"hooks,omitempty"`
}

type PluginInfo struct {
	Manifest PluginManifest         `json:"manifest"`
	Enabled  bool                   `json:"enabled"`
	Settings map[string]interface{} `json:"settings"`
}

// ============================================================
// Plugin Manager
// ============================================================

type pluginManager struct {
	mu       sync.RWMutex
	plugins  map[string]*PluginInfo
	settings map[string]map[string]interface{}
}

var pm = &pluginManager{
	plugins:  make(map[string]*PluginInfo),
	settings: make(map[string]map[string]interface{}),
}

func init() {
	// Register built-in plugins
	registerBuiltinPlugins()
	// Load saved settings
	loadPluginSettings()
}

func registerBuiltinPlugins() {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// 1. Reading Stats Enhanced
	pm.plugins["builtin-reading-stats"] = &PluginInfo{
		Manifest: PluginManifest{
			ID:          "builtin-reading-stats",
			Name:        "Reading Stats Enhanced",
			Version:     "1.0.0",
			Description: "Enhanced reading statistics with streak tracking and goals",
			Author:      "NowenReader",
			Permissions: []string{"comics:read"},
			Hooks:       []string{"onAfterRead", "onPageChange"},
		},
		Enabled: true,
		Settings: map[string]interface{}{
			"streakDays":     0,
			"lastReadDate":   "",
			"totalPagesRead": 0,
			"dailyGoalPages": 50,
		},
	}

	// 2. Auto Tagger
	pm.plugins["builtin-auto-tag"] = &PluginInfo{
		Manifest: PluginManifest{
			ID:          "builtin-auto-tag",
			Name:        "Auto Tagger",
			Version:     "1.0.0",
			Description: "Automatically tag comics based on filename patterns and metadata",
			Author:      "NowenReader",
			Permissions: []string{"comics:read", "comics:write"},
			Hooks:       []string{"onComicAdded"},
		},
		Enabled: true,
		Settings: map[string]interface{}{
			"enableAutoTag": true,
			"tagPatterns":   []interface{}{},
		},
	}

	// 3. AI Smart Tagger
	pm.plugins["builtin-ai-tagger"] = &PluginInfo{
		Manifest: PluginManifest{
			ID:          "builtin-ai-tagger",
			Name:        "AI Smart Tagger",
			Version:     "1.0.0",
			Description: "AI-powered automatic tagging based on cover analysis and metadata",
			Author:      "NowenReader",
			Permissions: []string{"comics:read", "comics:write", "network"},
			Hooks:       []string{"onComicAdded", "onMetadataScrape"},
		},
		Enabled: true,
		Settings: map[string]interface{}{
			"enableCoverAnalysis": true,
		},
	}

	// 4. Reading Goals
	pm.plugins["builtin-reading-goal"] = &PluginInfo{
		Manifest: PluginManifest{
			ID:          "builtin-reading-goal",
			Name:        "Reading Goals",
			Version:     "1.0.0",
			Description: "Set and track daily and weekly reading goals",
			Author:      "NowenReader",
			Permissions: []string{"comics:read", "ui:sidebar"},
			Hooks:       []string{"onAfterRead"},
		},
		Enabled: true,
		Settings: map[string]interface{}{
			"dailyGoalMinutes":  30,
			"weeklyGoalMinutes": 180,
		},
	}
}

func pluginSettingsPath() string {
	return filepath.Join(config.DataDir(), "plugin-settings.json")
}

func loadPluginSettings() {
	data, err := os.ReadFile(pluginSettingsPath())
	if err != nil {
		return
	}
	var saved map[string]map[string]interface{}
	if json.Unmarshal(data, &saved) == nil {
		pm.mu.Lock()
		defer pm.mu.Unlock()
		pm.settings = saved
		// Apply saved settings to plugins
		for id, settings := range saved {
			if p, ok := pm.plugins[id]; ok {
				for k, v := range settings {
					p.Settings[k] = v
				}
			}
		}
	}
}

func savePluginSettings() {
	pm.mu.RLock()
	data, _ := json.MarshalIndent(pm.settings, "", "  ")
	pm.mu.RUnlock()

	dir := filepath.Dir(pluginSettingsPath())
	os.MkdirAll(dir, 0755)
	_ = os.WriteFile(pluginSettingsPath(), data, 0644)
}

// ============================================================
// Public API
// ============================================================

// GetPlugins returns all registered plugins.
func GetPlugins() []PluginInfo {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	var plugins []PluginInfo
	for _, p := range pm.plugins {
		plugins = append(plugins, *p)
	}
	return plugins
}

// SetPluginEnabled enables/disables a plugin.
func SetPluginEnabled(pluginID string, enabled bool) bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	p, ok := pm.plugins[pluginID]
	if !ok {
		return false
	}
	p.Enabled = enabled
	return true
}

// UpdatePluginSettings updates settings for a plugin.
func UpdatePluginSettings(pluginID string, settings map[string]interface{}) bool {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	p, ok := pm.plugins[pluginID]
	if !ok {
		return false
	}
	for k, v := range settings {
		p.Settings[k] = v
	}

	if pm.settings[pluginID] == nil {
		pm.settings[pluginID] = make(map[string]interface{})
	}
	for k, v := range settings {
		pm.settings[pluginID][k] = v
	}

	go savePluginSettings()
	return true
}
