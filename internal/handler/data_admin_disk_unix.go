//go:build !windows

package handler

import "syscall"

// collectDiskInfo 在 unix 上使用 statfs 拿磁盘大小。
func collectDiskInfo(path string) diskInfo {
	info := diskInfo{Path: path}
	var fs syscall.Statfs_t
	if err := syscall.Statfs(path, &fs); err != nil {
		return info
	}
	info.Available = true
	info.TotalBytes = int64(fs.Blocks) * int64(fs.Bsize)
	info.FreeBytes = int64(fs.Bavail) * int64(fs.Bsize)
	info.UsedBytes = info.TotalBytes - info.FreeBytes
	if info.TotalBytes > 0 {
		info.UsedPercent = int(info.UsedBytes * 100 / info.TotalBytes)
	}
	return info
}
