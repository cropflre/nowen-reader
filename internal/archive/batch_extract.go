package archive

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/nwaples/rardecode/v2"
)

// ExtractImageBatch makes a single archive pass/process for a read-ahead range.
// The callback publishes each complete page through the service's atomic cache.
func ExtractImageBatch(reader Reader, names map[string]int, publish func(int, string, []byte) error) error {
	switch r := reader.(type) {
	case *rarReader:
		pending := make(map[string]int, len(names))
		for name, page := range names {
			pending[name] = page
		}
		rc, err := rardecode.OpenReader(r.filepath)
		if err != nil {
			return err
		}
		defer rc.Close()
		remaining := len(names)
		for remaining > 0 {
			header, err := rc.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return err
			}
			name := strings.ReplaceAll(header.Name, "\\", "/")
			index, wanted := pending[name]
			if !wanted {
				continue
			}
			data, err := io.ReadAll(rc)
			if err != nil {
				return err
			}
			if err := publish(index, name, data); err != nil {
				return err
			}
			remaining--
			delete(pending, name)
		}
		if remaining != 0 {
			return fmt.Errorf("%d batch entries missing from RAR", remaining)
		}
		return nil
	case *sevenZipReader:
		return r.extractImageBatch(names, publish)
	default:
		return fmt.Errorf("archive does not support batch extraction")
	}
}

func (s *sevenZipReader) extractImageBatch(names map[string]int, publish func(int, string, []byte) error) error {
	bin := find7za()
	if bin == "" {
		return fmt.Errorf("7za/7z not found")
	}
	return s.extractImageBatchWithBinary(bin, names, publish)
}

func (s *sevenZipReader) extractImageBatchWithBinary(bin string, names map[string]int, publish func(int, string, []byte) error) error {
	// Flat extraction avoids trusting archived directory paths. If basenames
	// collide, extract those entries individually so pages cannot overwrite one another.
	basenames := make(map[string]bool)
	ordered := make([]string, 0, len(names))
	collision := false
	for name := range names {
		base := path.Base(strings.ReplaceAll(name, "\\", "/"))
		if base == "." || base == "/" || base == "" {
			return fmt.Errorf("invalid batch entry %q", name)
		}
		folded := strings.ToLower(base)
		collision = collision || basenames[folded]
		basenames[folded] = true
		ordered = append(ordered, name)
	}
	sort.Slice(ordered, func(i, j int) bool { return names[ordered[i]] < names[ordered[j]] })
	if collision {
		for _, name := range ordered {
			data, err := s.ExtractEntry(name)
			if err != nil {
				return err
			}
			if err := publish(names[name], name, data); err != nil {
				return err
			}
		}
		return nil
	}
	dir, err := os.MkdirTemp("", "nowen-reader-batch-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	args := []string{"e", "-y", "-p", "-spd", "-o" + dir, "--", s.filepath}
	args = append(args, ordered...)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if out, err := exec.CommandContext(ctx, bin, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("7z batch extraction: %w: %s", err, out)
	}
	for _, name := range ordered {
		file := filepath.Join(dir, path.Base(strings.ReplaceAll(name, "\\", "/")))
		info, err := os.Lstat(file)
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("batch entry is missing or not a regular file: %s", name)
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		if err := publish(names[name], name, data); err != nil {
			return err
		}
	}
	return nil
}
