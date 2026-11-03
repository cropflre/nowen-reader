package archive

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestResizeWithCwebpStreamsOriginalImage(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake cwebp shell executable is only used on Unix test runners")
	}

	dir := t.TempDir()
	capturePath := filepath.Join(dir, "captured-input")
	executablePath := filepath.Join(dir, "fake-cwebp")
	script := "#!/bin/sh\ncat > \"$CAPTURE_PATH\"\nprintf 'fake-webp-output'\n"
	if err := os.WriteFile(executablePath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake cwebp: %v", err)
	}
	t.Setenv("CAPTURE_PATH", capturePath)

	img := image.NewRGBA(image.Rect(0, 0, 32, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 32; x++ {
			img.SetRGBA(x, y, color.RGBA{R: 180, G: 90, B: 30, A: 255})
		}
	}
	var source bytes.Buffer
	if err := jpeg.Encode(&source, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode source JPEG: %v", err)
	}

	output, err := resizeWithCwebp(executablePath, source.Bytes(), 400, 560, 80)
	if err != nil {
		t.Fatalf("resize with fake cwebp: %v", err)
	}
	if string(output) != "fake-webp-output" {
		t.Fatalf("output = %q", output)
	}

	captured, err := os.ReadFile(capturePath)
	if err != nil {
		t.Fatalf("read captured input: %v", err)
	}
	if !bytes.Equal(captured, source.Bytes()) {
		t.Fatal("cwebp input was transformed before being streamed; large JPEGs must remain compressed")
	}
}

func TestBuildCwebpCropArgs(t *testing.T) {
	tests := []struct {
		name                   string
		srcW, srcH, dstW, dstH int
		want                   []string
	}{
		{
			name: "matching aspect ratio needs no crop",
			srcW: 800, srcH: 1120, dstW: 400, dstH: 560,
			want: nil,
		},
		{
			name: "webtoon tall strip crops from top",
			srcW: 720, srcH: 9074, dstW: 400, dstH: 560,
			want: []string{"-crop", "0", "0", "720", "1008"},
		},
		{
			name: "wide spread crops horizontally centered and even-aligned",
			srcW: 1600, srcH: 1200, dstW: 400, dstH: 560,
			want: []string{"-crop", "372", "0", "856", "1200"},
		},
		{
			name: "tiny 1px wide image stays within bounds",
			srcW: 1, srcH: 10, dstW: 400, dstH: 560,
			want: []string{"-crop", "0", "0", "1", "1"},
		},
		{
			name: "invalid zero dimension returns nil",
			srcW: 0, srcH: 560, dstW: 400, dstH: 560,
			want: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildCwebpCropArgs(tt.srcW, tt.srcH, tt.dstW, tt.dstH)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("buildCwebpCropArgs(%d,%d,%d,%d) = %v, want %v",
					tt.srcW, tt.srcH, tt.dstW, tt.dstH, got, tt.want)
			}
		})
	}
}

func TestResizeWithCwebpPassesCropBeforeResize(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake cwebp shell executable is only used on Unix test runners")
	}

	dir := t.TempDir()
	argsPath := filepath.Join(dir, "captured-args")
	executablePath := filepath.Join(dir, "fake-cwebp")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$ARGS_PATH\"\ncat >/dev/null\nprintf 'fake-webp-output'\n"
	if err := os.WriteFile(executablePath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake cwebp: %v", err)
	}
	t.Setenv("ARGS_PATH", argsPath)

	img := image.NewRGBA(image.Rect(0, 0, 720, 3000))
	var source bytes.Buffer
	if err := png.Encode(&source, img); err != nil {
		t.Fatalf("encode source PNG: %v", err)
	}

	if _, err := resizeWithCwebp(executablePath, source.Bytes(), 400, 560, 80); err != nil {
		t.Fatalf("resizeWithCwebp: %v", err)
	}

	rawArgs, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatalf("read captured args: %v", err)
	}
	argsStr := strings.ReplaceAll(strings.TrimSpace(string(rawArgs)), "\n", " ")
	wantCrop := "-crop 0 0 720 1008"
	wantResize := "-resize 400 560"
	cropIdx := strings.Index(argsStr, wantCrop)
	resizeIdx := strings.Index(argsStr, wantResize)
	if cropIdx < 0 || resizeIdx < 0 || cropIdx > resizeIdx {
		t.Fatalf("unexpected cwebp args %q: want %q before %q", argsStr, wantCrop, wantResize)
	}
}

func TestResizeWithCwebpRejectsUnknownHeaderWithoutStretching(t *testing.T) {
	_, err := resizeWithCwebp("cwebp", []byte("not-a-valid-image-header"), 400, 560, 80)
	if err == nil {
		t.Fatal("expected error for unrecognized image header so caller can fall back to ffmpeg")
	}
}

func TestResizeWithCwebpRealWebtoonTopCropAndWebPInput(t *testing.T) {
	cwebpPath, err := exec.LookPath("cwebp")
	if err != nil {
		t.Skip("cwebp not installed in PATH")
	}

	// 构造 720x2800 条漫长图：顶部 1008px 为纯红，下方全为纯绿。
	// 正确顶部裁剪后，400x560 缩略图底部仍应为红色；若被直接拉伸，下半部分会变成绿色。
	strip := image.NewRGBA(image.Rect(0, 0, 720, 2800))
	for y := 0; y < 2800; y++ {
		c := color.RGBA{R: 0, G: 220, B: 0, A: 255}
		if y < 1008 {
			c = color.RGBA{R: 220, G: 20, B: 20, A: 255}
		}
		for x := 0; x < 720; x++ {
			strip.SetRGBA(x, y, c)
		}
	}
	var jpgBuf bytes.Buffer
	if err := jpeg.Encode(&jpgBuf, strip, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatalf("encode strip JPEG: %v", err)
	}

	webpThumb, err := resizeWithCwebp(cwebpPath, jpgBuf.Bytes(), 400, 560, 90)
	if err != nil {
		t.Fatalf("resizeWithCwebp on webtoon JPEG: %v", err)
	}

	decoded, format, err := image.Decode(bytes.NewReader(webpThumb))
	if err != nil {
		t.Fatalf("decode WebP output: %v", err)
	}
	if format != "webp" {
		t.Fatalf("decoded format = %q, want webp", format)
	}
	if decoded.Bounds().Dx() != 400 || decoded.Bounds().Dy() != 560 {
		t.Fatalf("decoded size = %dx%d, want 400x560", decoded.Bounds().Dx(), decoded.Bounds().Dy())
	}

	r, g, _, _ := decoded.At(200, 500).RGBA()
	if r>>8 < 160 || g>>8 > 80 {
		t.Fatalf("bottom pixel (200,500) RGB=(%d,%d,...), expected top-cropped red instead of squashed green", r>>8, g>>8)
	}

	// 验证 WebP 格式作为源图时，archive 包已注册 WebP 解码器且能继续正常裁剪缩放
	reEncoded, err := resizeWithCwebp(cwebpPath, webpThumb, 200, 200, 85)
	if err != nil {
		t.Fatalf("resizeWithCwebp on WebP input: %v", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(reEncoded))
	if err != nil || cfg.Width != 200 || cfg.Height != 200 {
		t.Fatalf("re-encoded WebP config = (%dx%d, err=%v), want 200x200", cfg.Width, cfg.Height, err)
	}
}
