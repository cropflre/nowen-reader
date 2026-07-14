package archive

import "testing"

func TestThumbnailMimeTypeUsesImageContent(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		expected string
	}{
		{name: "webp", data: []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), expected: "image/webp"},
		{name: "jpeg", data: []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}, expected: "image/jpeg"},
		{name: "png", data: []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, expected: "image/png"},
		{name: "unknown", data: []byte("not an image"), expected: "application/octet-stream"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := ThumbnailMimeType(tt.data); actual != tt.expected {
				t.Fatalf("ThumbnailMimeType() = %q, want %q", actual, tt.expected)
			}
		})
	}
}
