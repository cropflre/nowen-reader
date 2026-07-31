package service

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestNormalizeOPDSPSEJPEGResizesWithoutCropping(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			source.Set(x, y, color.NRGBA{R: 200, G: 20, B: 10, A: 255})
		}
	}
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, source); err != nil {
		t.Fatalf("encode source PNG: %v", err)
	}

	output, err := normalizeOPDSPSEJPEG(pngData.Bytes(), 2)
	if err != nil {
		t.Fatalf("normalize OPDS-PSE JPEG: %v", err)
	}
	decoded, err := jpeg.Decode(bytes.NewReader(output))
	if err != nil {
		t.Fatalf("decode normalized JPEG: %v", err)
	}
	if got := decoded.Bounds().Size(); got.X != 2 || got.Y != 1 {
		t.Fatalf("normalized size = %dx%d, want 2x1", got.X, got.Y)
	}
}

func TestNormalizeOPDSPSEJPEGKeepsSuitableJPEGBytes(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 2, 2))
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, source, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode source JPEG: %v", err)
	}

	output, err := normalizeOPDSPSEJPEG(jpegData.Bytes(), 4)
	if err != nil {
		t.Fatalf("normalize OPDS-PSE JPEG: %v", err)
	}
	if !bytes.Equal(output, jpegData.Bytes()) {
		t.Fatal("JPEG that already fits maxWidth should not be recompressed")
	}
}
