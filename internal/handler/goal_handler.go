package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// GoalHandler 处理阅读目标相关的API请求。
type GoalHandler struct{}

// NewGoalHandler 创建新的目标处理器。
func NewGoalHandler() *GoalHandler {
	return &GoalHandler{}
}

// GetGoalProgress 获取所有阅读目标的进度。
func (h *GoalHandler) GetGoalProgress(c *gin.Context) {
	uid := getUserID(c)
	progress, err := store.GetAllGoalProgress(uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, progress)
}

// SetGoal 创建或更新阅读目标。
func (h *GoalHandler) SetGoal(c *gin.Context) {
	var req struct {
		GoalType    string `json:"goalType" binding:"required"`
		TargetMins  int    `json:"targetMins"`
		TargetBooks int    `json:"targetBooks"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.GoalType != "daily" && req.GoalType != "weekly" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "goalType must be 'daily' or 'weekly'"})
		return
	}
	if req.TargetMins <= 0 && req.TargetBooks <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one of targetMins or targetBooks must be positive"})
		return
	}

	goal, err := store.SetReadingGoal(req.GoalType, req.TargetMins, req.TargetBooks, getUserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, goal)
}

// DeleteGoal 删除阅读目标。
func (h *GoalHandler) DeleteGoal(c *gin.Context) {
	goalType := c.Query("goalType")
	if goalType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "goalType is required"})
		return
	}

	if err := store.DeleteReadingGoal(goalType, getUserID(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
