package service

// ============================================================
// Multimodal Image Content (0-3)
// ============================================================

// ImageContent 用于传入图片（支持 base64 或 URL）
type ImageContent struct {
	// Base64 编码的图片数据（不含 data:image/xxx;base64, 前缀）
	Base64 string `json:"base64,omitempty"`
	// 图片 URL
	URL string `json:"url,omitempty"`
	// MIME 类型，如 image/jpeg, image/png
	MimeType string `json:"mimeType,omitempty"`
}

// CallCloudLLM 调用云端 LLM，支持重试和 token 统计。
