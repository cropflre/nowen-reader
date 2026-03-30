package archive

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	// Register decoders for common image formats
	_ "image/gif"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

// GenerateThumbnail generates a WebP thumbnail for a comic.
// Returns the thumbnail bytes, the original cover aspect ratio (width/height), and writes it to disk cache.
func GenerateThumbnail(archivePath, comicID string) ([]byte, float64, error) {
	thumbDir := config.GetThumbnailsDir()
	if err := os.MkdirAll(thumbDir, 0755); err != nil {
		return nil, 0, err
	}

	// 缓存路径包含尺寸信息，尺寸变更后自动生成新缩略图
	tw := config.GetThumbnailWidth()
	th := config.GetThumbnailHeight()
	cacheName := fmt.Sprintf("%s_%dx%d.webp", comicID, tw, th)
	cachePath := filepath.Join(thumbDir, cacheName)

	// Check cache first（尺寸匹配才命中）
	if data, err := os.ReadFile(cachePath); err == nil && len(data) > 0 {
		// 从缓存返回时，尝试检测已有缩略图的宽高比（无法获取原始比例，返回 0）
		return data, 0, nil
	}

	// 清理该 comicID 的旧尺寸缓存文件
	cleanOldThumbnailCache(thumbDir, comicID, cacheName)

	archiveType := DetectType(archivePath)

	var pageBuffer []byte

	switch {
	case archiveType == TypePdf:
		// PDF: render first page
		buf, err := RenderPdfPage(archivePath, 0)
		if err != nil {
			log.Printf("[thumbnail] PDF render failed for %s: %v, generating text cover", comicID, err)
			// 渲染工具不可用时，回退到文字封面
			data, err := generateTextCover(archivePath, comicID, thumbDir, cachePath)
			return data, 0, err
		}
		pageBuffer = buf

	case archiveType == TypeEpub || archiveType == TypeMobi || archiveType == TypeAzw3:
		// EPUB/MOBI/AZW3: try to extract cover image (MOBI/AZW3 auto-converted to EPUB)
		reader, err := NewReader(archivePath)
		if err != nil {
			return nil, 0, err
		}
		defer reader.Close()

		coverData, err := GetEpubCoverImage(reader)
		if err != nil {
			log.Printf("[thumbnail] EPUB cover extraction failed for %s: %v, generating text cover", comicID, err)
			// Fallback: generate a text-based cover
			data, err := generateTextCover(archivePath, comicID, thumbDir, cachePath)
			return data, 0, err
		}
		pageBuffer = coverData

	case archiveType == TypeTxt:
		// TXT: generate a text-based cover image
		data, err := generateTextCover(archivePath, comicID, thumbDir, cachePath)
		return data, 0, err

	default:
		// Open archive and extract first image
		reader, err := NewReader(archivePath)
		if err != nil {
			return nil, 0, err
		}
		defer reader.Close()

		images := GetImageEntries(reader)
		if len(images) == 0 {
			return nil, 0, fmt.Errorf("no images in archive %s", archivePath)
		}

		buf, err := reader.ExtractEntry(images[0])
		if err != nil {
			return nil, 0, fmt.Errorf("extract first page: %w", err)
		}
		pageBuffer = buf
	}

	if len(pageBuffer) == 0 {
		return nil, 0, fmt.Errorf("empty page buffer for %s", comicID)
	}

	// Detect original aspect ratio before resizing
	aspectRatio := detectAspectRatio(pageBuffer)

	// Generate thumbnail
	thumbnail, err := resizeToWebP(pageBuffer, config.GetThumbnailWidth(), config.GetThumbnailHeight(), 80)
	if err != nil {
		return nil, 0, err
	}

	// Write to cache (fire-and-forget)
	if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
		log.Printf("[thumbnail] Failed to write cache for %s: %v", comicID, err)
	}

	return thumbnail, aspectRatio, nil
}

// resizeToWebP resizes an image and converts it to WebP format.
// Tries external tools first (cwebp, ffmpeg), falls back to JPEG.
func resizeToWebP(imgData []byte, width, height, quality int) ([]byte, error) {
	// Method 1: Use cwebp (libwebp) for best quality
	if cwebp, err := exec.LookPath("cwebp"); err == nil {
		return resizeWithCwebp(cwebp, imgData, width, height, quality)
	}

	// Method 2: Use ffmpeg
	if ffmpeg, err := exec.LookPath("ffmpeg"); err == nil {
		return resizeWithFfmpeg(ffmpeg, imgData, width, height, quality)
	}

	// Method 3: Use Go native (resize + encode as JPEG with .webp extension)
	// This is a fallback — the file will actually be JPEG but named .webp
	// The Content-Type header will still serve it correctly
	return resizeGoNative(imgData, width, height, quality)
}

// resizeWithCwebp uses cwebp to resize and convert to WebP.
func resizeWithCwebp(cwebpPath string, imgData []byte, width, height, quality int) ([]byte, error) {
	// First, we need to get the image as PNG for cwebp input
	pngData, err := toPNG(imgData)
	if err != nil {
		// Try passing raw data directly
		pngData = imgData
	}

	// cwebp -resize W H -q quality -o - -- -
	cmd := exec.Command(cwebpPath, "-resize", fmt.Sprintf("%d", width), fmt.Sprintf("%d", height),
		"-q", fmt.Sprintf("%d", quality), "-o", "-", "--", "-")
	cmd.Stdin = bytes.NewReader(pngData)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("cwebp: %w", err)
	}
	return out, nil
}

// resizeWithFfmpeg uses ffmpeg to resize and convert to WebP.
func resizeWithFfmpeg(ffmpegPath string, imgData []byte, width, height, quality int) ([]byte, error) {
	// ffmpeg -i pipe:0 -vf "scale=W:H:force_original_aspect_ratio=increase,crop=W:H:(iw-W)/2:0"
	//        -c:v libwebp -quality Q -f webp pipe:1
	filter := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d:(iw-%d)/2:0",
		width, height, width, height, width)
	cmd := exec.Command(ffmpegPath, "-y", "-i", "pipe:0",
		"-vf", filter,
		"-c:v", "libwebp", "-quality", fmt.Sprintf("%d", quality),
		"-f", "webp", "pipe:1")
	cmd.Stdin = bytes.NewReader(imgData)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg: %w (%s)", err, stderr.String())
	}
	return stdout.Bytes(), nil
}

// resizeGoNative uses Go's standard library for resizing.
// Outputs JPEG (closest we can do without cgo WebP libs).
func resizeGoNative(imgData []byte, width, height, quality int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(imgData))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}

	// Simple nearest-neighbor resize (cover fit, crop from top)
	srcBounds := img.Bounds()
	srcW := srcBounds.Dx()
	srcH := srcBounds.Dy()

	// Calculate scale to cover target dimensions
	scaleX := float64(width) / float64(srcW)
	scaleY := float64(height) / float64(srcH)
	scale := scaleX
	if scaleY > scaleX {
		scale = scaleY
	}

	scaledW := int(float64(srcW) * scale)

	// Create resized image with simple bilinear-ish sampling
	dst := image.NewRGBA(image.Rect(0, 0, width, height))

	// Offset for "top" position (crop from top center)
	offsetX := (scaledW - width) / 2
	offsetY := 0 // top position

	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			srcX := int(float64(x+offsetX) / scale)
			srcY := int(float64(y+offsetY) / scale)
			if srcX >= srcW {
				srcX = srcW - 1
			}
			if srcY >= srcH {
				srcY = srcH - 1
			}
			if srcX < 0 {
				srcX = 0
			}
			if srcY < 0 {
				srcY = 0
			}
			dst.Set(x, y, img.At(srcBounds.Min.X+srcX, srcBounds.Min.Y+srcY))
		}
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode jpeg: %w", err)
	}
	return buf.Bytes(), nil
}

// toPNG converts image data to PNG format.
func toPNG(imgData []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(imgData))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ResizeImageToWebP is a public helper for cover upload processing.
// quality 85 for user uploads.
func ResizeImageToWebP(imgData []byte, width, height, quality int) ([]byte, error) {
	return resizeToWebP(imgData, width, height, quality)
}

// ThumbnailCacheName returns the canonical cache filename for a comic thumbnail.
// All code that reads/writes thumbnail cache MUST use this function to ensure consistency.
func ThumbnailCacheName(comicID string) string {
	tw := config.GetThumbnailWidth()
	th := config.GetThumbnailHeight()
	return fmt.Sprintf("%s_%dx%d.webp", comicID, tw, th)
}

// ClearThumbnailCache removes all cached thumbnails for a given comic ID,
// including the old format ({id}.webp) and all sized variants ({id}_{W}x{H}.webp).
func ClearThumbnailCache(comicID string) {
	thumbDir := config.GetThumbnailsDir()
	// Remove old format
	oldPath := filepath.Join(thumbDir, comicID+".webp")
	_ = os.Remove(oldPath)
	// Remove all sized variants
	entries, err := os.ReadDir(thumbDir)
	if err != nil {
		return
	}
	prefix := comicID + "_"
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), prefix) {
			_ = os.Remove(filepath.Join(thumbDir, entry.Name()))
		}
	}
}

// cleanOldThumbnailCache 删除同一 comicID 的旧尺寸缓存文件（包括旧格式 comicID.webp）。
func cleanOldThumbnailCache(thumbDir, comicID, currentCacheName string) {
	// 清理旧格式缓存 comicID.webp（不含尺寸后缀）
	oldFormatPath := filepath.Join(thumbDir, comicID+".webp")
	if _, err := os.Stat(oldFormatPath); err == nil {
		_ = os.Remove(oldFormatPath)
	}

	// 清理同 comicID 但不同尺寸的缓存
	entries, err := os.ReadDir(thumbDir)
	if err != nil {
		return
	}
	prefix := comicID + "_"
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, prefix) && name != currentCacheName {
			_ = os.Remove(filepath.Join(thumbDir, name))
		}
	}
}

// generateTextCover creates a simple image thumbnail for text files.
// Uses Go's image library to draw a colored background with the title.
func generateTextCover(filePath, comicID, thumbDir, cachePath string) ([]byte, error) {
	// 从配置读取缩略图尺寸，而不是硬编码
	width := config.GetThumbnailWidth()
	height := config.GetThumbnailHeight()

	// Create a gradient-like background
	dst := image.NewRGBA(image.Rect(0, 0, width, height))

	// Generate a consistent color based on filename hash
	hash := []byte(comicID)
	hue := int(hash[0]) % 6
	var bgR, bgG, bgB uint8
	switch hue {
	case 0:
		bgR, bgG, bgB = 59, 130, 246 // blue
	case 1:
		bgR, bgG, bgB = 16, 185, 129 // green
	case 2:
		bgR, bgG, bgB = 245, 158, 11 // amber
	case 3:
		bgR, bgG, bgB = 239, 68, 68 // red
	case 4:
		bgR, bgG, bgB = 139, 92, 246 // purple
	default:
		bgR, bgG, bgB = 236, 72, 153 // pink
	}

	// Fill background
	for y := 0; y < height; y++ {
		// Slight vertical gradient
		factor := float64(y) / float64(height)
		r := uint8(float64(bgR) * (1.0 - factor*0.3))
		g := uint8(float64(bgG) * (1.0 - factor*0.3))
		b := uint8(float64(bgB) * (1.0 - factor*0.3))
		for x := 0; x < width; x++ {
			dst.Set(x, y, color.RGBA{R: r, G: g, B: b, A: 255})
		}
	}

	// Draw a book icon area (white rectangle in center-top)
	iconTop := 120
	iconW := 160
	iconH := 200
	iconLeft := (width - iconW) / 2
	for y := iconTop; y < iconTop+iconH; y++ {
		for x := iconLeft; x < iconLeft+iconW; x++ {
			dst.Set(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 60})
		}
	}

	// Draw "TXT" or "EPUB" label
	ext := strings.ToUpper(strings.TrimPrefix(filepath.Ext(filePath), "."))
	// Draw simple pixel text for the extension label
	drawSimpleText(dst, ext, width/2, iconTop+iconH/2, color.RGBA{R: 255, G: 255, B: 255, A: 200})

	// Encode as JPEG (will be served as webp via Content-Type)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, fmt.Errorf("encode text cover: %w", err)
	}

	thumbnail := buf.Bytes()

	// Write to cache
	if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
		log.Printf("[thumbnail] Failed to write text cover cache for %s: %v", comicID, err)
	}

	return thumbnail, nil
}

// detectAspectRatio decodes image bytes and returns width/height ratio.
// Returns 0 if the image cannot be decoded.
func detectAspectRatio(imgData []byte) float64 {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(imgData))
	if err != nil {
		return 0
	}
	if cfg.Height == 0 {
		return 0
	}
	return float64(cfg.Width) / float64(cfg.Height)
}

// drawSimpleText draws a simple blocky text string centered at (cx, cy).
func drawSimpleText(img *image.RGBA, text string, cx, cy int, clr color.RGBA) {
	// Simple 5x7 pixel font for uppercase letters and digits
	glyphs := map[rune][]string{
		'T': {"#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "},
		'X': {"#   #", " # # ", "  #  ", "  #  ", " # # ", "#   #", "#   #"},
		'E': {"#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"},
		'P': {"#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "},
		'U': {"#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "},
		'B': {"#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "},
		'M': {"#   #", "## ##", "# # #", "#   #", "#   #", "#   #", "#   #"},
		'O': {" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "},
		'I': {"#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "#####"},
		'A': {" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"},
		'W': {"#   #", "#   #", "#   #", "#   #", "# # #", "## ##", "#   #"},
		'Z': {"#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"},
		'3': {"#####", "    #", "    #", " ### ", "    #", "    #", "#####"},
	}

	scale := 4
	charW := 5*scale + scale // char width + spacing
	totalW := len(text) * charW
	startX := cx - totalW/2

	for i, ch := range text {
		glyph, ok := glyphs[ch]
		if !ok {
			continue
		}
		ox := startX + i*charW
		oy := cy - (7*scale)/2

		for row, line := range glyph {
			for col, pixel := range line {
				if pixel == '#' {
					for dy := 0; dy < scale; dy++ {
						for dx := 0; dx < scale; dx++ {
							px := ox + col*scale + dx
							py := oy + row*scale + dy
							if px >= 0 && px < img.Bounds().Dx() && py >= 0 && py < img.Bounds().Dy() {
								img.Set(px, py, clr)
							}
						}
					}
				}
			}
		}
	}
}
