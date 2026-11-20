package handler

import (
	"archive/zip"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

func TestDeletePhysicalEpubClosesPooledReader(t *testing.T) {
	r := setupTestRouter(t)
	cookie := registerAndLogin(t, r)

	root := t.TempDir()
	const filename = "Robinson Crusoe.epub"
	filePath := filepath.Join(root, filename)
	writeMinimalEpub(t, filePath)

	library := &model.Library{
		ID:            "physical-delete-library",
		Name:          "Physical Delete Library",
		Type:          "novel",
		RootPath:      root,
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(library); err != nil {
		t.Fatalf("CreateLibrary failed: %v", err)
	}

	comicID := store.PathToID(library.ID, filename)
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath")
		VALUES (?, ?, 'Robinson Crusoe', 'novel', ?, ?)
	`, comicID, filename, library.ID, filename); err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	// Opening the book populates the service reader pool. On Windows the
	// underlying zip.ReadCloser keeps the EPUB locked until explicitly closed.
	pages, err := service.GetComicPagesEx(comicID)
	if err != nil {
		t.Fatalf("GetComicPagesEx failed: %v", err)
	}
	if len(pages.Entries) != 1 {
		t.Fatalf("chapter count = %d, want 1", len(pages.Entries))
	}

	w := performAuthedRequest(r, http.MethodDelete, "/api/comics/"+comicID+"?deleteFiles=true", nil, cookie)
	if w.Code != http.StatusOK {
		t.Fatalf("physical delete: %d %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Fatalf("physical EPUB still exists after delete: %v", err)
	}
	comic, err := store.GetComicByID(comicID)
	if err != nil {
		t.Fatalf("GetComicByID failed: %v", err)
	}
	if comic != nil {
		t.Fatal("database row still exists after physical delete")
	}
}

func writeMinimalEpub(t *testing.T, target string) {
	t.Helper()
	file, err := os.Create(target)
	if err != nil {
		t.Fatalf("create epub: %v", err)
	}
	writer := zip.NewWriter(file)

	writeEntry := func(name, content string) {
		t.Helper()
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create epub entry %s: %v", name, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write epub entry %s: %v", name, err)
		}
	}

	writeEntry("mimetype", "application/epub+zip")
	writeEntry("META-INF/container.xml", `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
	writeEntry("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Robinson Crusoe</dc:title></metadata>
  <manifest><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter1"/></spine>
</package>`)
	writeEntry("OEBPS/chapter1.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p>Content</p></body></html>`)

	if err := writer.Close(); err != nil {
		file.Close()
		t.Fatalf("close epub writer: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close epub file: %v", err)
	}
}

func TestDeletePermissions_AdminOnly(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	r := setupTestRouter(t)
	adminSession := registerAndLogin(t, r)

	root := t.TempDir()
	lib := &model.Library{
		ID:            "perm-delete-lib",
		Name:          "Permission Delete Lib",
		Type:          "comic",
		RootPath:      root,
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatalf("CreateLibrary: %v", err)
	}

	bookRel := filepath.Join("author-a", "book.cbz")
	bookPath := filepath.Join(root, bookRel)
	if err := os.MkdirAll(filepath.Dir(bookPath), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(bookPath, []byte("cbz-data"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	comicID := store.PathToID(lib.ID, bookRel)
	if _, err := store.DB().Exec(`
		INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath", "format")
		VALUES (?, ?, 'Book A', 'comic', ?, ?, 'CBZ')
	`, comicID, filepath.ToSlash(bookRel), lib.ID, filepath.ToSlash(bookRel)); err != nil {
		t.Fatalf("insert comic: %v", err)
	}

	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle")
		VALUES ('perm-series', ?, 'author-a', 'Series A', 'series a')
	`, lib.ID); err != nil {
		t.Fatalf("insert series: %v", err)
	}

	sessions := map[string]string{"admin": adminSession}
	for _, role := range []string{"viewer", "manager"} {
		if err := store.CreateUser(&model.User{
			ID: role, Username: role, Password: "unused", Role: "user", AiEnabled: false,
		}); err != nil {
			t.Fatalf("create user %s: %v", role, err)
		}
		if err := store.SetUserLibraryAccess(role, []store.LibraryAccessReq{{
			LibraryID: lib.ID,
			CanView:   true,
			CanManage: role == "manager",
		}}); err != nil {
			t.Fatalf("set library access %s: %v", role, err)
		}
		sess := role + "-session"
		if err := store.CreateSession(&model.UserSession{
			ID: sess, UserID: role, ExpiresAt: time.Now().Add(time.Hour),
		}); err != nil {
			t.Fatalf("create session %s: %v", role, err)
		}
		sessions[role] = sess
	}

	// Non-admin users (including library canManage=true manager) MUST receive 403 on all delete endpoints.
	for _, role := range []string{"viewer", "manager"} {
		for _, tc := range []struct {
			name   string
			method string
			path   string
			body   interface{}
		}{
			{"single_record_delete", http.MethodDelete, "/api/comics/" + comicID, nil},
			{"single_file_delete", http.MethodDelete, "/api/comics/" + comicID + "?deleteFiles=true", nil},
			{"batch_record_delete", http.MethodPost, "/api/comics/batch", map[string]interface{}{"action": "delete", "comicIds": []string{comicID}}},
			{"batch_file_delete", http.MethodPost, "/api/comics/batch", map[string]interface{}{"action": "delete", "comicIds": []string{comicID}, "deleteFiles": true}},
			{"series_record_delete", http.MethodDelete, "/api/series/perm-series", nil},
			{"series_content_delete", http.MethodDelete, "/api/series/perm-series?deleteContent=true&deleteFiles=true", nil},
		} {
			resp := performAuthedRequest(r, tc.method, tc.path, tc.body, sessions[role])
			if resp.Code != http.StatusForbidden {
				t.Fatalf("%s as %s: status = %d, want 403; body = %s", tc.name, role, resp.Code, resp.Body.String())
			}
		}
	}

	// Verify file and DB rows remain completely untouched after forbidden requests.
	if _, err := os.Stat(bookPath); err != nil {
		t.Fatalf("book file disappeared after 403 requests: %v", err)
	}
	if got, err := store.GetComicByID(comicID); err != nil || got == nil {
		t.Fatalf("comic missing from DB after 403 requests (got=%v, err=%v)", got, err)
	}

	// Global admin succeeds.
	adminResp := performAuthedRequest(r, http.MethodDelete, "/api/comics/"+comicID+"?deleteFiles=true", nil, sessions["admin"])
	if adminResp.Code != http.StatusOK {
		t.Fatalf("admin physical delete: status = %d, body = %s", adminResp.Code, adminResp.Body.String())
	}
	if _, err := os.Stat(bookPath); !os.IsNotExist(err) {
		t.Fatalf("book file still exists after admin physical delete: %v", err)
	}
}

func TestBatchDeleteSeriesAndEditionsWithEmptyDirPruning(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	r := setupTestRouter(t)
	adminSession := registerAndLogin(t, r)

	root := t.TempDir()
	lib := &model.Library{
		ID:            "batch-prune-lib",
		Name:          "Batch Prune Lib",
		Type:          "comic",
		RootPath:      root,
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatalf("CreateLibrary: %v", err)
	}

	// 1. A directory series with 2 chapters + an OS junk file (.DS_Store) in nested subdirs
	ch1Rel := filepath.Join("author-empty", "my-series", "ch1.cbz")
	ch2Rel := filepath.Join("author-empty", "my-series", "ch2.cbz")
	// 2. A multi-format book (EPUB + PDF) in another subdirectory
	edEpubRel := filepath.Join("editions-dir", "dune.epub")
	edPdfRel := filepath.Join("editions-dir", "dune.pdf")
	// 3. An untouched sibling file in a kept folder to ensure non-empty folders are preserved
	keptRel := filepath.Join("kept-dir", "keep-me.cbz")

	for _, rel := range []string{ch1Rel, ch2Rel, edEpubRel, edPdfRel, keptRel} {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatalf("mkdir %s: %v", rel, err)
		}
		if err := os.WriteFile(full, []byte("payload"), 0644); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}
	// Put .DS_Store inside author-empty/my-series so we verify OS junk doesn't block dir pruning
	if err := os.WriteFile(filepath.Join(root, "author-empty", "my-series", ".DS_Store"), []byte("junk"), 0644); err != nil {
		t.Fatalf("write .DS_Store: %v", err)
	}

	ch1ID := store.PathToID(lib.ID, ch1Rel)
	ch2ID := store.PathToID(lib.ID, ch2Rel)
	edEpubID := store.PathToID(lib.ID, edEpubRel)
	edPdfID := store.PathToID(lib.ID, edPdfRel)
	keptID := store.PathToID(lib.ID, keptRel)

	for _, item := range []struct {
		id, name, rel, typ, fmt string
	}{
		{ch1ID, "ch1.cbz", ch1Rel, "comic", "CBZ"},
		{ch2ID, "ch2.cbz", ch2Rel, "comic", "CBZ"},
		{edEpubID, "dune.epub", edEpubRel, "novel", "EPUB"},
		{edPdfID, "dune.pdf", edPdfRel, "novel", "PDF"},
		{keptID, "keep-me.cbz", keptRel, "comic", "CBZ"},
	} {
		if _, err := store.DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath", "format")
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, item.id, filepath.ToSlash(item.rel), item.name, item.typ, lib.ID, filepath.ToSlash(item.rel), item.fmt); err != nil {
			t.Fatalf("insert comic %s: %v", item.id, err)
		}
	}

	// Series tables
	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle")
		VALUES ('batch-series-1', ?, 'author-empty/my-series', 'My Series', 'my series')
	`, lib.ID); err != nil {
		t.Fatalf("insert series: %v", err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "ComicSeriesItem" ("seriesId", "comicId", "sortIndex") VALUES
		('batch-series-1', ?, 0),
		('batch-series-1', ?, 1)
	`, ch1ID, ch2ID); err != nil {
		t.Fatalf("insert series items: %v", err)
	}

	// Multi-format edition group
	if _, err := store.DB().Exec(`
		INSERT INTO "BookEditionGroup" ("id", "contentType", "mergeScope", "matchKey", "title", "sortTitle", "defaultComicId", "formatsJson", "editionCount")
		VALUES ('ed-grp-dune', 'novel', 'library', 'dune', 'Dune', 'dune', ?, '["EPUB","PDF"]', 2)
	`, edEpubID); err != nil {
		t.Fatalf("insert edition group: %v", err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "BookEditionItem" ("groupId", "comicId", "libraryId", "format", "formatPriority", "isFormatPrimary", "sortIndex") VALUES
		('ed-grp-dune', ?, ?, 'EPUB', 1, 1, 0),
		('ed-grp-dune', ?, ?, 'PDF', 2, 0, 1)
	`, edEpubID, lib.ID, edPdfID, lib.ID); err != nil {
		t.Fatalf("insert edition items: %v", err)
	}

	// Batch delete series-batch-series-1 AND edEpubID (expecting sibling edPdfID + all empty dirs pruned)
	resp := performAuthedRequest(r, http.MethodPost, "/api/comics/batch", map[string]interface{}{
		"action":      "delete",
		"comicIds":    []string{"series-batch-series-1", edEpubID},
		"deleteFiles": true,
	}, adminSession)
	if resp.Code != http.StatusOK {
		t.Fatalf("batch delete: status = %d, body = %s", resp.Code, resp.Body.String())
	}

	// Deleted files must not exist
	for _, rel := range []string{ch1Rel, ch2Rel, edEpubRel, edPdfRel} {
		if _, err := os.Stat(filepath.Join(root, rel)); !os.IsNotExist(err) {
			t.Fatalf("expected deleted file %s to not exist: %v", rel, err)
		}
	}
	// Empty subdirectories (even nested author-empty with .DS_Store, and editions-dir) should be pruned
	for _, dir := range []string{
		filepath.Join(root, "author-empty", "my-series"),
		filepath.Join(root, "author-empty"),
		filepath.Join(root, "editions-dir"),
	} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("expected empty dir %s to be pruned: %v", dir, err)
		}
	}
	// Library rootPath and kept sibling dir/file MUST still exist
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("library rootPath missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, keptRel)); err != nil {
		t.Fatalf("kept file missing: %v", err)
	}
	// Series row and edition group row must be gone from DB
	var seriesCount, groupCount int
	_ = store.DB().QueryRow(`SELECT COUNT(*) FROM "ComicSeries" WHERE "id" = 'batch-series-1'`).Scan(&seriesCount)
	_ = store.DB().QueryRow(`SELECT COUNT(*) FROM "BookEditionGroup" WHERE "id" = 'ed-grp-dune'`).Scan(&groupCount)
	if seriesCount != 0 || groupCount != 0 {
		t.Fatalf("expected series and edition group deleted, got series=%d group=%d", seriesCount, groupCount)
	}
}

func TestSingleFormatDeletePreservesRemainingEditions(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	r := setupTestRouter(t)
	adminSession := registerAndLogin(t, r)

	root := t.TempDir()
	lib := &model.Library{
		ID:            "single-fmt-lib",
		Name:          "Single Fmt Lib",
		Type:          "novel",
		RootPath:      root,
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := store.CreateLibrary(lib); err != nil {
		t.Fatalf("CreateLibrary: %v", err)
	}

	epubRel := filepath.Join("novels", "book.epub")
	pdfRel := filepath.Join("novels", "book.pdf")
	for _, rel := range []string{epubRel, pdfRel} {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(full, []byte("data"), 0644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	epubID := store.PathToID(lib.ID, epubRel)
	pdfID := store.PathToID(lib.ID, pdfRel)
	for _, item := range []struct{ id, name, rel, fmt string }{
		{epubID, "book.epub", epubRel, "EPUB"},
		{pdfID, "book.pdf", pdfRel, "PDF"},
	} {
		if _, err := store.DB().Exec(`
			INSERT INTO "Comic" ("id", "filename", "title", "type", "libraryId", "relativePath", "format")
			VALUES (?, ?, 'Sample Book', 'novel', ?, ?, ?)
		`, item.id, filepath.ToSlash(item.rel), lib.ID, filepath.ToSlash(item.rel), item.fmt); err != nil {
			t.Fatalf("insert comic: %v", err)
		}
	}

	if _, err := store.DB().Exec(`
		INSERT INTO "BookEditionGroup" ("id", "contentType", "mergeScope", "matchKey", "title", "sortTitle", "defaultComicId", "formatsJson", "editionCount")
		VALUES ('ed-grp-single', 'novel', 'library', 'sample book', 'Sample Book', 'sample book', ?, '["EPUB","PDF"]', 2)
	`, epubID); err != nil {
		t.Fatalf("insert group: %v", err)
	}
	if _, err := store.DB().Exec(`
		INSERT INTO "BookEditionItem" ("groupId", "comicId", "libraryId", "format", "formatPriority", "isFormatPrimary", "sortIndex") VALUES
		('ed-grp-single', ?, ?, 'EPUB', 1, 1, 0),
		('ed-grp-single', ?, ?, 'PDF', 2, 0, 1)
	`, epubID, lib.ID, pdfID, lib.ID); err != nil {
		t.Fatalf("insert items: %v", err)
	}

	// Delete only PDF format with deleteEditions=false
	resp := performAuthedRequest(r, http.MethodDelete, "/api/comics/"+pdfID+"?deleteFiles=true&deleteEditions=false", nil, adminSession)
	if resp.Code != http.StatusOK {
		t.Fatalf("single format delete: status = %d, body = %s", resp.Code, resp.Body.String())
	}

	if _, err := os.Stat(filepath.Join(root, pdfRel)); !os.IsNotExist(err) {
		t.Fatalf("PDF should be deleted from disk: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, epubRel)); err != nil {
		t.Fatalf("EPUB must remain on disk: %v", err)
	}
	if epubComic, err := store.GetComicByID(epubID); err != nil || epubComic == nil {
		t.Fatalf("EPUB comic should still exist in DB (comic=%v, err=%v)", epubComic, err)
	}
	if pdfComic, err := store.GetComicByID(pdfID); err != nil || pdfComic != nil {
		t.Fatalf("PDF comic should be deleted from DB (comic=%v, err=%v)", pdfComic, err)
	}
	// Group should be dissolved or down to 0/1 properly without orphan PDF item
	var pdfItemCount int
	_ = store.DB().QueryRow(`SELECT COUNT(*) FROM "BookEditionItem" WHERE "comicId" = ?`, pdfID).Scan(&pdfItemCount)
	if pdfItemCount != 0 {
		t.Fatalf("expected BookEditionItem removed for pdfID, got %d", pdfItemCount)
	}
}
