package handler

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

// LogHandler 处理日志查看相关的API
type LogHandler struct{}

// NewLogHandler 创建日志处理器
func NewLogHandler() *LogHandler {
	return &LogHandler{}
}

// GetErrorLogs 获取错误日志列表
func (h *LogHandler) GetErrorLogs(c *gin.Context) {
	buf := middleware.GetErrorLogBuffer()
	entries := buf.GetAll()

	// 支持分页
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}

	total := len(entries)
	start := (page - 1) * pageSize
	end := start + pageSize
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}

	// 支持按状态码过滤
	statusFilter := c.Query("status")
	if statusFilter != "" {
		filterCode, err := strconv.Atoi(statusFilter)
		if err == nil {
			filtered := make([]middleware.ErrorLogEntry, 0)
			for _, e := range entries {
				if e.Status == filterCode {
					filtered = append(filtered, e)
				}
			}
			entries = filtered
			total = len(entries)
			if start > total {
				start = total
			}
			end = start + pageSize
			if end > total {
				end = total
			}
		}
	}

	// 支持按方法过滤
	methodFilter := c.Query("method")
	if methodFilter != "" {
		filtered := make([]middleware.ErrorLogEntry, 0)
		for _, e := range entries {
			if e.Method == methodFilter {
				filtered = append(filtered, e)
			}
		}
		entries = filtered
		total = len(entries)
		if start > total {
			start = total
		}
		end = start + pageSize
		if end > total {
			end = total
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"logs":     entries[start:end],
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

// ClearErrorLogs 清空错误日志
func (h *LogHandler) ClearErrorLogs(c *gin.Context) {
	buf := middleware.GetErrorLogBuffer()
	buf.Clear()
	c.JSON(http.StatusOK, gin.H{"message": "Logs cleared"})
}

// GetErrorLogStats 获取错误日志统计
func (h *LogHandler) GetErrorLogStats(c *gin.Context) {
	buf := middleware.GetErrorLogBuffer()
	entries := buf.GetAll()

	statusCounts := make(map[int]int)
	methodCounts := make(map[string]int)
	pathCounts := make(map[string]int)

	for _, e := range entries {
		statusCounts[e.Status]++
		methodCounts[e.Method]++
		pathCounts[e.Path]++
	}

	// 取 Top 10 路径
	type pathCount struct {
		Path  string `json:"path"`
		Count int    `json:"count"`
	}
	topPaths := make([]pathCount, 0)
	for p, cnt := range pathCounts {
		topPaths = append(topPaths, pathCount{Path: p, Count: cnt})
	}
	// 按 count 降序排序
	for i := 0; i < len(topPaths); i++ {
		for j := i + 1; j < len(topPaths); j++ {
			if topPaths[j].Count > topPaths[i].Count {
				topPaths[i], topPaths[j] = topPaths[j], topPaths[i]
			}
		}
	}
	if len(topPaths) > 10 {
		topPaths = topPaths[:10]
	}

	c.JSON(http.StatusOK, gin.H{
		"total":        len(entries),
		"statusCounts": statusCounts,
		"methodCounts": methodCounts,
		"topPaths":     topPaths,
	})
}

// ExportErrorLogs 导出错误日志（支持JSON和CSV格式）
func (h *LogHandler) ExportErrorLogs(c *gin.Context) {
	buf := middleware.GetErrorLogBuffer()
	entries := buf.GetAll()

	// 支持按状态码过滤
	if statusFilter := c.Query("status"); statusFilter != "" {
		if filterCode, err := strconv.Atoi(statusFilter); err == nil {
			filtered := make([]middleware.ErrorLogEntry, 0)
			for _, e := range entries {
				if e.Status == filterCode {
					filtered = append(filtered, e)
				}
			}
			entries = filtered
		}
	}

	// 支持按方法过滤
	if methodFilter := c.Query("method"); methodFilter != "" {
		filtered := make([]middleware.ErrorLogEntry, 0)
		for _, e := range entries {
			if e.Method == methodFilter {
				filtered = append(filtered, e)
			}
		}
		entries = filtered
	}

	format := c.DefaultQuery("format", "json")
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("error_logs_%s", timestamp)

	switch format {
	case "csv":
		filename += ".csv"
		c.Header("Content-Type", "text/csv; charset=utf-8")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
		// 写入 BOM 以便 Excel 正确识别 UTF-8
		c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

		w := csv.NewWriter(c.Writer)
		// 写入表头
		w.Write([]string{"Time", "Status", "Method", "Path", "ClientIP", "Latency", "LatencyMs", "BodySize", "Error"})
		for _, e := range entries {
			w.Write([]string{
				e.Time,
				strconv.Itoa(e.Status),
				e.Method,
				e.Path,
				e.ClientIP,
				e.Latency,
				strconv.FormatInt(e.LatencyMs, 10),
				strconv.Itoa(e.BodySize),
				e.Error,
			})
		}
		w.Flush()

	default: // json
		filename += ".json"
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))

		exportData := gin.H{
			"exportTime": time.Now().Format("2006-01-02 15:04:05"),
			"total":      len(entries),
			"logs":       entries,
		}
		data, err := json.MarshalIndent(exportData, "", "  ")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to marshal logs"})
			return
		}
		c.Writer.Write(data)
	}
}
