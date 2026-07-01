package store

type LibraryAccessReq struct {
	LibraryID   string `json:"libraryId"`
	CanView     bool   `json:"canView"`
	CanDownload bool   `json:"canDownload"`
	CanManage   bool   `json:"canManage"`
}
