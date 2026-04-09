package service

import (
	"fmt"
	"strings"
)

// ============================================================
// Phase 3-1: AI 阅读助手 (Chat)
// ============================================================

// ChatMessage 聊天消息
type ChatMessage struct {
	Role    string `json:"role"` // "user" 或 "assistant"
	Content string `json:"content"`
}

// ChatWithContextStream 带上下文的 AI 阅读助手，流式返回。
// context: 当前阅读内容（漫画页图片 base64 或小说文本）
// history: 对话历史
// question: 用户当前问题
func ChatWithContextStream(cfg AIConfig, title, contentType, targetLang string,
	contextText string, contextImage *ImageContent,
	history []ChatMessage, question string, callback StreamCallback) error {

	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a helpful reading assistant for a %s titled "%s". The user is currently reading this work and may ask about characters, plot, vocabulary, cultural references, or request translations.

Rules:
- Answer in %s
- Be concise but helpful (1-3 sentences unless more detail is needed)
- If you're given the current page/chapter content, use it to provide context-aware answers
- If the user asks about something not in the current context, answer based on general knowledge
- For manga/comics: you may receive the current page image — describe what you see if asked
- For novels: you may receive the current chapter text — help with comprehension if asked
- Be friendly and conversational, like a knowledgeable reading companion`, contentType, title, langName)

	// 构建完整的用户消息（包含上下文）
	fullUserMsg := question
	if contextText != "" {
		// 截断过长的文本上下文（避免超出 token 限制）
		ctx := contextText
		if len(ctx) > 3000 {
			ctx = ctx[:3000] + "\n...[text truncated]..."
		}
		fullUserMsg = fmt.Sprintf("[Current reading content]\n%s\n\n[User question]\n%s", ctx, question)
	} else if contextImage == nil {
		fullUserMsg = fmt.Sprintf("[User question]\n%s", question)
	}

	// 构建对话历史为 prompt（简化实现：将历史拼接到 user prompt 中）
	if len(history) > 0 {
		// 只保留最近 6 轮对话
		recent := history
		if len(recent) > 12 {
			recent = recent[len(recent)-12:]
		}
		var historyText strings.Builder
		historyText.WriteString("[Conversation history]\n")
		for _, msg := range recent {
			if msg.Role == "user" {
				historyText.WriteString(fmt.Sprintf("User: %s\n", msg.Content))
			} else {
				historyText.WriteString(fmt.Sprintf("Assistant: %s\n", msg.Content))
			}
		}
		historyText.WriteString("\n")
		fullUserMsg = historyText.String() + fullUserMsg
	}

	// 使用流式调用
	opts := &LLMCallOptions{
		Scenario:  "chat",
		MaxTokens: cfg.MaxTokens,
	}

	// 如果有图片上下文（漫画当前页），使用多模态
	if contextImage != nil {
		// 多模态流式尚不支持，回退到非流式调用后逐字模拟
		opts.Images = []ImageContent{*contextImage}
		result, err := CallCloudLLM(cfg, systemPrompt, fullUserMsg, opts)
		if err != nil {
			return err
		}
		// 逐段返回（模拟流式体验）
		chunkSize := 20 // 每次返回约 20 字符
		for i := 0; i < len(result); i += chunkSize {
			end := i + chunkSize
			if end > len(result) {
				end = len(result)
			}
			if !callback(StreamChunk{Content: result[i:end]}) {
				return nil
			}
		}
		callback(StreamChunk{Done: true})
		return nil
	}

	return CallCloudLLMStream(cfg, systemPrompt, fullUserMsg, opts, callback)
}
