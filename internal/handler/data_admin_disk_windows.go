//go:build windows

package handler

import (
	"syscall"
	"unsafe"
)

// collectDiskInfo 在 Windows 上调用 GetDiskFreeSpaceExW。
func collectDiskInfo(path string) diskInfo {
	info := diskInfo{Path: path}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetDiskFreeSpaceExW")

	pathPtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return info
	}

	var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes uint64
	r1, _, _ := proc.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalNumberOfBytes)),
		uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
	)
	if r1 == 0 {
		return info
	}
	info.Available = true
	info.TotalBytes = int64(totalNumberOfBytes)
	info.FreeBytes = int64(freeBytesAvailable)
	info.UsedBytes = info.TotalBytes - info.FreeBytes
	if info.TotalBytes > 0 {
		info.UsedPercent = int(info.UsedBytes * 100 / info.TotalBytes)
	}
	return info
}
