package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

// getUserID 从请求上下文中安全提取当前用户 ID。
// 如果未登录则返回空字符串（兼容单用户模式）。
func getUserID(c *gin.Context) string {
	if u := middleware.GetCurrentUser(c); u != nil {
		return u.ID
	}
	return ""
}
