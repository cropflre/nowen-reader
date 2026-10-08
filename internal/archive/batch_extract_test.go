package archive

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

// Build a small stored RAR4 fixture, including file/header CRCs, without
// requiring a proprietary RAR writer on the test host.
func storedRAR(t *testing.T) string {
	t.Helper()
	var data bytes.Buffer
	data.WriteString("Rar!\x1a\x07\x00")
	block := func(kind byte, flags uint16, extra []byte) {
		header := make([]byte, 7)
		header[2] = kind
		binary.LittleEndian.PutUint16(header[3:], flags)
		binary.LittleEndian.PutUint16(header[5:], uint16(7+len(extra)))
		header = append(header, extra...)
		binary.LittleEndian.PutUint16(header, uint16(crc32.ChecksumIEEE(header[2:])))
		data.Write(header)
	}
	block(0x73, 0, make([]byte, 6))
	for _, name := range []string{"chapter/000.png", "chapter/001.png", "chapter/002.png"} {
		content := []byte("pixels:" + name)
		extra := make([]byte, 25)
		binary.LittleEndian.PutUint32(extra, uint32(len(content)))
		binary.LittleEndian.PutUint32(extra[4:], uint32(len(content)))
		extra[8] = 3
		binary.LittleEndian.PutUint32(extra[9:], crc32.ChecksumIEEE(content))
		extra[17] = 20
		extra[18] = 0x30
		binary.LittleEndian.PutUint16(extra[19:], uint16(len(name)))
		block(0x74, 0x8000, append(extra, []byte(name)...))
		data.Write(content)
	}
	block(0x7b, 0, nil)
	file := filepath.Join(t.TempDir(), "pages.rar")
	if err := os.WriteFile(file, data.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestRARImageBatchSelectedPagesAndPublishFailure(t *testing.T) {
	r, err := newRarReader(storedRAR(t))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	names := map[string]int{"chapter/001.png": 1, "chapter/002.png": 2}
	got := map[int]string{}
	err = ExtractImageBatch(r, names, func(page int, name string, data []byte) error {
		got[page] = string(data)
		if string(data) != "pixels:"+name {
			t.Fatalf("wrong page bytes: %s", data)
		}
		return nil
	})
	if err != nil || len(got) != 2 || len(names) != 2 {
		t.Fatalf("batch: %v %v", got, err)
	}
	err = ExtractImageBatch(r, map[string]int{"missing.png": 5}, func(int, string, []byte) error { return nil })
	if err == nil {
		t.Fatal("missing page was silently accepted")
	}
	err = ExtractImageBatch(r, names, func(int, string, []byte) error { return os.ErrPermission })
	if err != os.ErrPermission {
		t.Fatalf("lost publish failure: %v", err)
	}
}

func TestSevenZipBatchUsesOneProcessAndCleansTemporaryFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-7z")
	log := filepath.Join(dir, "calls")
	t.Setenv("BATCH_TEST_LOG", log)
	t.Setenv("BATCH_TEST_OUT", filepath.Join(dir, "outdir"))
	// Emulate flat extraction while recording every process invocation.
	script := `#!/bin/sh
echo called >> "$BATCH_TEST_LOG"
for arg in "$@"; do
  case "$arg" in -o*) out=${arg#-o} ;; esac
done
echo "$out" > "$BATCH_TEST_OUT"
while [ "$1" != "--" ]; do shift; done
shift
shift
for name in "$@"; do printf 'pixels:%s' "$name" > "$out/${name##*/}"; done
`
	if err := os.WriteFile(bin, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	r := &sevenZipReader{filepath: filepath.Join(dir, "archive with spaces.7z")}
	got := []int{}
	err := r.extractImageBatchWithBinary(bin, map[string]int{"folder/001.png": 1, "folder/002.png": 2}, func(page int, name string, data []byte) error {
		got = append(got, page)
		if string(data) != "pixels:"+name {
			t.Fatalf("wrong extracted page: %s", data)
		}
		return nil
	})
	if err != nil || !reflect.DeepEqual(got, []int{1, 2}) {
		t.Fatalf("batch: %v %v", got, err)
	}
	calls, err := os.ReadFile(log)
	if err != nil || string(calls) != "called\n" {
		t.Fatalf("batch launched multiple processes: %q %v", calls, err)
	}
	outputDir, err := os.ReadFile(filepath.Join(dir, "outdir"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(string(bytes.TrimSpace(outputDir))); !os.IsNotExist(err) {
		t.Fatalf("temporary extraction files leaked: %v", err)
	}
}
