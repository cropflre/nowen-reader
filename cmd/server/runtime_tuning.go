package main

import (
	"log"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
)

const (
	gib                    = int64(1024 * 1024 * 1024)
	lowMemoryDeviceCeiling = 6 * gib
	lowMemoryHeapCeiling   = 1 * gib
)

func init() {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NOWEN_LOW_MEMORY_MODE")), "off") {
		return
	}
	memoryLimit := effectiveMemoryLimitBytes()
	if memoryLimit <= 0 || memoryLimit > lowMemoryDeviceCeiling {
		return
	}

	if strings.TrimSpace(os.Getenv("GOMAXPROCS")) == "" && runtime.NumCPU() > 2 {
		previous := runtime.GOMAXPROCS(2)
		log.Printf("[runtime] low-memory mode: effectiveMemory=%dMB GOMAXPROCS=%d->2", memoryLimit/1024/1024, previous)
	}
	if strings.TrimSpace(os.Getenv("GOMEMLIMIT")) == "" {
		heapLimit := memoryLimit / 3
		if heapLimit > lowMemoryHeapCeiling {
			heapLimit = lowMemoryHeapCeiling
		}
		if heapLimit < 256*1024*1024 {
			heapLimit = 256 * 1024 * 1024
		}
		debug.SetMemoryLimit(heapLimit)
		log.Printf("[runtime] low-memory mode: Go soft memory limit=%dMB (override with GOMEMLIMIT or NOWEN_LOW_MEMORY_MODE=off)", heapLimit/1024/1024)
	}
}

func effectiveMemoryLimitBytes() int64 {
	limits := make([]int64, 0, 3)
	// cgroup v2
	if value := readMemoryLimitFile("/sys/fs/cgroup/memory.max"); value > 0 {
		limits = append(limits, value)
	}
	// cgroup v1
	if value := readMemoryLimitFile("/sys/fs/cgroup/memory/memory.limit_in_bytes"); value > 0 {
		limits = append(limits, value)
	}
	if value := readProcMemTotal(); value > 0 {
		limits = append(limits, value)
	}
	if len(limits) == 0 {
		return 0
	}
	min := limits[0]
	for _, value := range limits[1:] {
		if value < min {
			min = value
		}
	}
	return min
}

func readMemoryLimitFile(path string) int64 {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	value := strings.TrimSpace(string(data))
	if value == "" || value == "max" {
		return 0
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n <= 0 || n > 1<<60 {
		return 0
	}
	return n
}

func readProcMemTotal() int64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kb, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil || kb <= 0 {
			return 0
		}
		return kb * 1024
	}
	return 0
}
