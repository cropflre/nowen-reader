package service

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	stddraw "image/draw"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
	_ "golang.org/x/image/bmp"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	opdsPSEDefaultMaxWidth = 4096
	opdsPSEMaxPixels       = 100_000_000
	opdsPSEJPEGQuality     = 90
)

type opdsPSEPageCall struct {
	done   chan struct{}
	result *PageImage
	err    error
}

var (
	opdsPSEPageCallsMu  sync.Mutex
	opdsPSEPageCalls    = make(map[string]*opdsPSEPageCall)
	opdsPSEConvertSlots = make(chan struct{}, 2)
)

// GetOPDSPSEPageImage returns a page normalized to JPEG. Archive extraction
// and PDF rendering still use the regular reader path; only the final image
// representation is specific to OPDS-PSE.
func GetOPDSPSEPageImage(comicID string, pageIndex, maxWidth int) (*PageImage, error) {
	if pageIndex < 0 || maxWidth < 0 || maxWidth > opdsPSEDefaultMaxWidth {
		return nil, fmt.Errorf("invalid OPDS-PSE page request")
	}

	sourcePath, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return nil, err
	}
	pages, err := GetComicPagesEx(comicID)
	if err != nil {
		return nil, err
	}
	if pages.IsNovel || pageIndex >= len(pages.Entries) {
		return nil, fmt.Errorf("page index %d out of range", pageIndex)
	}
	signature := fmt.Sprintf("%x", sha256.Sum256([]byte(
		sourcePath+":"+strconv.FormatInt(info.Size(), 10)+":"+strconv.FormatInt(info.ModTime().UnixNano(), 10),
	)))[:16]
	cacheWidth := maxWidth
	if cacheWidth == 0 {
		cacheWidth = opdsPSEDefaultMaxWidth
	}
	cachePath := filepath.Join(
		config.GetPagesCacheDir(),
		comicID,
		"opds-pse",
		signature,
		fmt.Sprintf("%d-%d.jpg", pageIndex, cacheWidth),
	)
	if data, readErr := os.ReadFile(cachePath); readErr == nil && len(data) > 0 {
		return &PageImage{Data: data, MimeType: "image/jpeg"}, nil
	}

	callKey := cachePath
	opdsPSEPageCallsMu.Lock()
	if existing := opdsPSEPageCalls[callKey]; existing != nil {
		opdsPSEPageCallsMu.Unlock()
		<-existing.done
		return existing.result, existing.err
	}
	call := &opdsPSEPageCall{done: make(chan struct{})}
	opdsPSEPageCalls[callKey] = call
	opdsPSEPageCallsMu.Unlock()

	defer func() {
		opdsPSEPageCallsMu.Lock()
		delete(opdsPSEPageCalls, callKey)
		close(call.done)
		opdsPSEPageCallsMu.Unlock()
	}()

	source, err := GetPageImage(comicID, pageIndex)
	if err != nil {
		call.err = err
		return nil, err
	}
	if source == nil || len(source.Data) == 0 {
		err = fmt.Errorf("empty page image")
		call.err = err
		return nil, err
	}

	opdsPSEConvertSlots <- struct{}{}
	data, err := normalizeOPDSPSEJPEG(source.Data, maxWidth)
	<-opdsPSEConvertSlots
	if err != nil {
		call.err = err
		return nil, err
	}
	result := &PageImage{Data: data, MimeType: "image/jpeg"}
	call.result = result

	if err := writeOPDSPSECache(cachePath, data); err != nil {
		// A cache failure must not make an otherwise valid page unreadable.
		return result, nil
	}
	return result, nil
}

func normalizeOPDSPSEJPEG(data []byte, maxWidth int) ([]byte, error) {
	targetMaxWidth := maxWidth
	if targetMaxWidth <= 0 {
		targetMaxWidth = opdsPSEDefaultMaxWidth
	}

	cfg, format, configErr := image.DecodeConfig(bytes.NewReader(data))
	if configErr == nil {
		if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > opdsPSEMaxPixels {
			return nil, fmt.Errorf("page dimensions exceed OPDS-PSE limits")
		}
		if format == "jpeg" && cfg.Width <= targetMaxWidth {
			return data, nil
		}
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return transcodeOPDSPSEWithFFmpeg(data, targetMaxWidth)
	}
	bounds := src.Bounds()
	srcWidth, srcHeight := bounds.Dx(), bounds.Dy()
	if srcWidth <= 0 || srcHeight <= 0 || int64(srcWidth)*int64(srcHeight) > opdsPSEMaxPixels {
		return nil, fmt.Errorf("page dimensions exceed OPDS-PSE limits")
	}

	dstWidth := srcWidth
	if dstWidth > targetMaxWidth {
		dstWidth = targetMaxWidth
	}
	dstHeight := max(1, int(float64(srcHeight)*float64(dstWidth)/float64(srcWidth)))
	dst := image.NewRGBA(image.Rect(0, 0, dstWidth, dstHeight))
	stddraw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, stddraw.Src)
	if dstWidth == srcWidth {
		stddraw.Draw(dst, dst.Bounds(), src, bounds.Min, stddraw.Over)
	} else {
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, stddraw.Over, nil)
	}

	var output bytes.Buffer
	if err := jpeg.Encode(&output, dst, &jpeg.Options{Quality: opdsPSEJPEGQuality}); err != nil {
		return nil, fmt.Errorf("encode OPDS-PSE JPEG: %w", err)
	}
	return output.Bytes(), nil
}

func transcodeOPDSPSEWithFFmpeg(data []byte, maxWidth int) ([]byte, error) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("decode page image: unsupported source format and ffmpeg is unavailable")
	}
	filter := fmt.Sprintf("scale=min(iw\\,%d):-2", maxWidth)
	cmd := exec.Command(
		ffmpeg,
		"-v", "error",
		"-i", "pipe:0",
		"-vf", filter,
		"-frames:v", "1",
		"-c:v", "mjpeg",
		"-q:v", "2",
		"-f", "image2pipe",
		"pipe:1",
	)
	cmd.Stdin = bytes.NewReader(data)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("transcode OPDS-PSE page: %w (%s)", err, stderr.String())
	}
	if len(output) == 0 {
		return nil, fmt.Errorf("transcode OPDS-PSE page: ffmpeg returned empty output (%s)", stderr.String())
	}
	return output, nil
}

func writeOPDSPSECache(cachePath string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return err
	}
	tmpPath := cachePath + fmt.Sprintf(".%d.tmp", time.Now().UnixNano())
	defer os.Remove(tmpPath)
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, cachePath)
}
