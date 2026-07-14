package main

import "testing"

func TestFormatVersionForDisplay(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected string
	}{
		{name: "tagged release", value: "v1.2.0", expected: "v1.2.0"},
		{name: "duplicate prefix", value: "vv1.2.0", expected: "v1.2.0"},
		{name: "untagged release", value: "1.2.0", expected: "v1.2.0"},
		{name: "git describe", value: "v1.2.0-3-gf653fa4", expected: "v1.2.0-3-gf653fa4"},
		{name: "development", value: "dev", expected: "dev"},
		{name: "docker", value: "docker", expected: "docker"},
		{name: "commit hash", value: "f653fa4", expected: "f653fa4"},
		{name: "whitespace", value: "  v1.2.0  ", expected: "v1.2.0"},
		{name: "empty", value: "", expected: "..."},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if actual := formatVersionForDisplay(tt.value); actual != tt.expected {
				t.Fatalf("formatVersionForDisplay(%q) = %q, want %q", tt.value, actual, tt.expected)
			}
		})
	}
}
