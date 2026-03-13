package archive

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	// Register decoders for common image formats
	_ "image/gif"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

// GenerateThumbnail generates a WebP thumbnail for a comic.
// Returns the thumbnail bytes and writes it to disk cache.
func GenerateThumbnail(archivePath, comicID string) ([]byte, error) {
	thumbDir := config.GetThumbnailsDir()
	if err := os.MkdirAll(thumbDir, 0755); err != nil {
		return nil, err
	}

	cachePath := filepath.Join(thumbDir, comicID+".webp")

	// Check cache first
	if data, err := os.ReadFile(cachePath); err == nil && len(data) > 0 {
		return data, nil
	}

	archiveType := DetectType(archivePath)

	var pageBuffer []byte

	if archiveType == TypePdf {
		// PDF: render first page
		buf, err := RenderPdfPage(archivePath, 0)
		if err != nil {
			log.Printf("[thumbnail] PDF render failed for %s: %v", comicID, err)
			return nil, err
		}
		pageBuffer = buf
	} else {
		// Open archive and extract first image
		reader, err := NewReader(archivePath)
		if err != nil {
			return nil, err
		}
		defer reader.Close()

		images := GetImageEntries(reader)
		if len(images) == 0 {
			return nil, fmt.Errorf("no images in archive %s", archivePath)
		}

		buf, err := reader.ExtractEntry(images[0])
		if err != nil {
			return nil, fmt.Errorf("extract first page: %w", err)
		}
		pageBuffer = buf
	}

	if len(pageBuffer) == 0 {
		return nil, fmt.Errorf("empty page buffer for %s", comicID)
	}

	// Generate thumbnail
	thumbnail, err := resizeToWebP(pageBuffer, config.GetThumbnailWidth(), config.GetThumbnailHeight(), 80)
	if err != nil {
		return nil, err
	}

	// Write to cache (fire-and-forget)
	if err := os.WriteFile(cachePath, thumbnail, 0644); err != nil {
		log.Printf("[thumbnail] Failed to write cache for %s: %v", comicID, err)
	}

	return thumbnail, nil
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
