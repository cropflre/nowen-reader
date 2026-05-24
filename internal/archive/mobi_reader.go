package archive

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"os"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"
)

// ============================================================
// 纯 Go MOBI/AZW3 解析器
// 支持 MOBI (Mobipocket) 和 AZW3 (KF8) 格式
// 无需外部依赖（Calibre ebook-convert）
// ============================================================

// MOBI 格式常量
const (
	mobiMagicMOBI = "MOBI"
	mobiMagicBOOK = "BOOK" // PalmDB type for Mobipocket
	mobiMagicEXTH = "EXTH"

	// PalmDOC 压缩类型
	palmDocNoCompression = 1
	palmDocPalmDOC       = 2
	palmDocHuffCDIC      = 17480

	// MOBI 类型
	mobiTypeMobipocket = 2
	mobiTypeKF8        = 248 // AZW3/KF8

	// MOBI 编码
	mobiEncodingLatin1 = 1252
	mobiEncodingUTF8   = 65001

	// EXTH 记录类型
	exthAuthor      = 100
	exthPublisher   = 101
	exthDescription = 103
	exthISBN        = 104
	exthSubject     = 105
	exthDate        = 106
	exthTitle       = 503
	exthLanguage    = 524
	exthKF8Boundary = 121 // KF8 boundary record index

	// KF8 资源记录标识
	kf8ResourceMagicFDST = "FDST"
	kf8ResourceMagicSKEL = "SKEL"
	kf8ResourceMagicFRAG = "FRAG"
)

// palmDBHeader PalmDB 文件头（78 字节）
type palmDBHeader struct {
	Name           [32]byte
	Attributes     uint16
	Version        uint16
	CreationDate   uint32
	ModDate        uint32
	BackupDate     uint32
	ModNum         uint32
	AppInfoOffset  uint32
	SortInfoOffset uint32
	Type           [4]byte
	Creator        [4]byte
	UniqueIDSeed   uint32
	NextRecordList uint32
	NumRecords     uint16
}

// palmDBRecord PalmDB 记录偏移表项
type palmDBRecord struct {
	Offset     uint32
	Attributes uint8
	UniqueID   [3]byte
}

// mobiHeader MOBI 头部结构
type mobiHeader struct {
	Compression    uint16
	_              uint16 // unused
	TextLength     uint32
	RecordCount    uint16
	RecordSize     uint16
	EncryptionType uint16
	_              uint16 // unused
}

// mobiExthRecord EXTH 扩展头记录
type mobiExthRecord struct {
	Type   uint32
	Length uint32
	Data   []byte
}

// mobiBook 解析后的 MOBI 书籍数据
type mobiBook struct {
	filePath string
	fileData []byte

	// PalmDB
	pdbHeader palmDBHeader
	records   []palmDBRecord

	// MOBI 头部字段
	compression    uint16
	textLength     uint32
	textRecCount   uint16
	recordSize     uint16
	encryptionType uint16
	mobiType       uint32
	encoding       uint32
	mobiHeaderLen  uint32
	firstImageIdx  uint32
	firstResIdx    uint32 // first non-book record index
	kf8Boundary    int    // KF8 boundary record index (-1 if not KF8 dual)

	// EXTH 元数据
	title       string
	author      string
	publisher   string
	description string
	isbn        string
	subject     string
	date        string
	language    string

	// 解析后的内容
	htmlContent string
	images      []mobiImage
	chapters    []mobiChapter
}

// mobiImage MOBI 中的图片资源
type mobiImage struct {
	index    int
	data     []byte
	mimeType string
}

// mobiChapter MOBI 中的章节
type mobiChapter struct {
	title       string
	htmlContent string
	textContent string
}

// ============================================================
// MOBI Reader（实现 archive.Reader 接口）
// ============================================================

type mobiReader struct {
	book     *mobiBook
	entries  []Entry
	chapters []mobiChapter
}

func newNativeMobiReader(fp string) (*mobiReader, error) {
	data, err := os.ReadFile(fp)
	if err != nil {
		return nil, fmt.Errorf("read mobi file %s: %w", fp, err)
	}

	book, err := parseMobi(data, fp)
	if err != nil {
		return nil, fmt.Errorf("parse mobi %s: %w", fp, err)
	}

	r := &mobiReader{
		book: book,
	}

	// 判断是否为漫画模式（图片为主）
	// 图片数量多于章节数量且图片 >= 5 张时，按图片模式构建条目列表
	isImageMode := len(book.images) >= 5 && len(book.images) > len(book.chapters)

	if isImageMode {
		// 漫画模式：每张图片作为一页
		r.entries = make([]Entry, 0, len(book.images))
		for _, img := range book.images {
			ext := ".jpg"
			switch img.mimeType {
			case "image/png":
				ext = ".png"
			case "image/gif":
				ext = ".gif"
			case "image/webp":
				ext = ".webp"
			case "image/bmp":
				ext = ".bmp"
			}
			r.entries = append(r.entries, Entry{
				Name:        fmt.Sprintf("page-%04d%s", img.index+1, ext),
				IsDirectory: false,
			})
		}
	} else {
		// 小说模式：每个章节作为一页
		r.chapters = book.chapters
		r.entries = make([]Entry, 0, len(r.chapters))
		for i := range r.chapters {
			r.entries = append(r.entries, Entry{
				Name:        fmt.Sprintf("chapter-%04d.html", i+1),
				IsDirectory: false,
			})
		}
	}

	return r, nil
}

func (r *mobiReader) ListEntries() []Entry {
	return r.entries
}

func (r *mobiReader) ExtractEntry(entryName string) ([]byte, error) {
	for i, e := range r.entries {
		if e.Name == entryName {
			// 漫画模式：条目是图片页
			if strings.HasPrefix(e.Name, "page-") && i < len(r.book.images) {
				return r.book.images[i].data, nil
			}
			// 小说模式：条目是章节
			if i < len(r.chapters) {
				ch := r.chapters[i]
				if ch.htmlContent != "" {
					return []byte(ch.htmlContent), nil
				}
				return []byte(ch.textContent), nil
			}
		}
	}

	// 尝试提取图片资源（通过 recindex: 前缀）
	if strings.HasPrefix(entryName, "recindex:") {
		var idx int
		fmt.Sscanf(entryName, "recindex:%d", &idx)
		for _, img := range r.book.images {
			if img.index == idx {
				return img.data, nil
			}
		}
	}

	return nil, fmt.Errorf("entry not found in mobi: %s", entryName)
}

// ExtractEntryText 返回章节的纯文本内容
func (r *mobiReader) ExtractEntryText(entryName string) ([]byte, error) {
	for i, e := range r.entries {
		if e.Name == entryName {
			return []byte(r.chapters[i].textContent), nil
		}
	}
	return nil, fmt.Errorf("entry not found in mobi: %s", entryName)
}

func (r *mobiReader) Close() {
	// 释放内存
	if r.book != nil {
		r.book.fileData = nil
		r.book.images = nil
	}
}

// GetCoverImage 获取 MOBI 封面图片
func (r *mobiReader) GetCoverImage() ([]byte, error) {
	if len(r.book.images) > 0 {
		return r.book.images[0].data, nil
	}
	return nil, fmt.Errorf("no cover image found in MOBI")
}

// GetChapterTitles 获取章节标题列表
func (r *mobiReader) GetChapterTitles() []string {
	titles := make([]string, len(r.chapters))
	for i, ch := range r.chapters {
		titles[i] = ch.title
	}
	return titles
}

// ============================================================
// MOBI 格式解析核心
// ============================================================

func parseMobi(data []byte, filePath string) (*mobiBook, error) {
	if len(data) < 78 {
		return nil, fmt.Errorf("file too small to be a valid MOBI file")
	}

	book := &mobiBook{
		filePath:    filePath,
		fileData:    data,
		kf8Boundary: -1,
	}

	// 1. 解析 PalmDB 头部
	if err := book.parsePDBHeader(); err != nil {
		return nil, fmt.Errorf("parse PDB header: %w", err)
	}

	// 2. 解析记录偏移表
	if err := book.parsePDBRecords(); err != nil {
		return nil, fmt.Errorf("parse PDB records: %w", err)
	}

	// 3. 解析 Record 0（MOBI 头部 + EXTH）
	if err := book.parseRecord0(); err != nil {
		return nil, fmt.Errorf("parse Record 0: %w", err)
	}

	// 4. 提取文本内容
	if err := book.extractText(); err != nil {
		return nil, fmt.Errorf("extract text: %w", err)
	}

	// 5. 提取图片资源
	book.extractImages()

	// 6. 分割章节
	book.splitChapters()

	// 7. 如果标题是 Calibre 内部 ID（如 "CR!6HCD1AS3010MFE8P4K8H6Q9D2QQ0"），
	//    尝试从 HTML 的 <title> 或 <dc:title> 标签提取真实标题
	if book.title == "" || isCalibreInternalID(book.title) {
		if extracted := extractTitleFromHTML(book.htmlContent); extracted != "" {
			book.title = extracted
		} else {
			// 最后回退：使用文件名（去除扩展名）
			base := path.Base(filePath)
			ext := path.Ext(base)
			book.title = strings.TrimSuffix(base, ext)
		}
	}

	log.Printf("[mobi] Parsed %s: type=%d, encoding=%d, chapters=%d, images=%d, title=%q",
		path.Base(filePath), book.mobiType, book.encoding, len(book.chapters), len(book.images), book.title)

	return book, nil
}

// parsePDBHeader 解析 PalmDB 文件头
func (book *mobiBook) parsePDBHeader() error {
	r := bytes.NewReader(book.fileData)
	if err := binary.Read(r, binary.BigEndian, &book.pdbHeader); err != nil {
		return fmt.Errorf("read PDB header: %w", err)
	}
	return nil
}

// isCalibreInternalID 检测字符串是否为 Calibre 生成的内部 ID
// Calibre 内部 ID 格式：CR!XXXXXXXXXXXXXXX（以 "CR!" 开头，后跟字母数字）
func isCalibreInternalID(s string) bool {
	return strings.HasPrefix(s, "CR!") && len(s) > 3
}

// extractTitleFromHTML 从 HTML 内容中提取 <title> 标签文本
func extractTitleFromHTML(html string) string {
	// 尝试匹配 <title>...</title>
	re := regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)
	matches := re.FindStringSubmatch(html)
	if len(matches) >= 2 {
		title := strings.TrimSpace(matches[1])
		// 去除 HTML 实体
		title = strings.ReplaceAll(title, "&amp;", "&")
		title = strings.ReplaceAll(title, "&lt;", "<")
		title = strings.ReplaceAll(title, "&gt;", ">")
		title = strings.ReplaceAll(title, "&quot;", `"`)
		title = strings.ReplaceAll(title, "&#39;", "'")
		if title != "" && !isCalibreInternalID(title) {
			return title
		}
	}
	return ""
}

// parsePDBRecords 解析 PalmDB 记录偏移表
func (book *mobiBook) parsePDBRecords() error {
	numRecords := int(book.pdbHeader.NumRecords)
	if numRecords == 0 {
		return fmt.Errorf("no records in PDB file")
	}

	book.records = make([]palmDBRecord, numRecords)
	offset := 78 // PDB header size
	r := bytes.NewReader(book.fileData[offset:])

	for i := 0; i < numRecords; i++ {
		var rec palmDBRecord
		if err := binary.Read(r, binary.BigEndian, &rec.Offset); err != nil {
			return fmt.Errorf("read record %d offset: %w", i, err)
		}
		if err := binary.Read(r, binary.BigEndian, &rec.Attributes); err != nil {
			return fmt.Errorf("read record %d attributes: %w", i, err)
		}
		if _, err := r.Read(rec.UniqueID[:]); err != nil {
			return fmt.Errorf("read record %d uniqueID: %w", i, err)
		}
		book.records[i] = rec
	}

	return nil
}

// getRecordData 获取指定记录的数据
func (book *mobiBook) getRecordData(index int) ([]byte, error) {
	if index < 0 || index >= len(book.records) {
		return nil, fmt.Errorf("record index %d out of range (0-%d)", index, len(book.records)-1)
	}

	start := int(book.records[index].Offset)
	var end int
	if index+1 < len(book.records) {
		end = int(book.records[index+1].Offset)
	} else {
		end = len(book.fileData)
	}

	if start > len(book.fileData) || end > len(book.fileData) || start >= end {
		return nil, fmt.Errorf("invalid record %d bounds: start=%d, end=%d, fileSize=%d", index, start, end, len(book.fileData))
	}

	return book.fileData[start:end], nil
}

// parseRecord0 解析 Record 0（PalmDOC 头 + MOBI 头 + EXTH）
func (book *mobiBook) parseRecord0() error {
	rec0, err := book.getRecordData(0)
	if err != nil {
		return fmt.Errorf("get record 0: %w", err)
	}

	if len(rec0) < 16 {
		return fmt.Errorf("record 0 too small: %d bytes", len(rec0))
	}

	// PalmDOC 头部（16 字节）
	book.compression = binary.BigEndian.Uint16(rec0[0:2])
	book.textLength = binary.BigEndian.Uint32(rec0[4:8])
	book.textRecCount = binary.BigEndian.Uint16(rec0[8:10])
	book.recordSize = binary.BigEndian.Uint16(rec0[10:12])
	book.encryptionType = binary.BigEndian.Uint16(rec0[12:14])

	if book.encryptionType != 0 {
		return fmt.Errorf("encrypted MOBI files are not supported (encryption type: %d)", book.encryptionType)
	}

	// 检查是否有 MOBI 头部
	if len(rec0) < 20 {
		// 纯 PalmDOC 文件，没有 MOBI 头
		book.encoding = mobiEncodingLatin1
		return nil
	}

	// MOBI 头部从偏移 16 开始
	mobiStart := 16
	if len(rec0) < mobiStart+4 {
		return nil
	}

	// 检查 MOBI 魔数
	magic := string(rec0[mobiStart : mobiStart+4])
	if magic != mobiMagicMOBI {
		// 没有 MOBI 头，可能是纯 PalmDOC
		book.encoding = mobiEncodingLatin1
		return nil
	}

	// 解析 MOBI 头部字段
	if len(rec0) < mobiStart+8 {
		return fmt.Errorf("MOBI header too short")
	}
	book.mobiHeaderLen = binary.BigEndian.Uint32(rec0[mobiStart+4 : mobiStart+8])

	if len(rec0) >= mobiStart+12 {
		book.mobiType = binary.BigEndian.Uint32(rec0[mobiStart+8 : mobiStart+12])
	}

	if len(rec0) >= mobiStart+16 {
		book.encoding = binary.BigEndian.Uint32(rec0[mobiStart+12 : mobiStart+16])
	} else {
		book.encoding = mobiEncodingLatin1
	}

	// First image record index (偏移 108 from MOBI header start, 即 rec0[16+108])
	if len(rec0) >= mobiStart+112 {
		book.firstImageIdx = binary.BigEndian.Uint32(rec0[mobiStart+108 : mobiStart+112])
	}

	// First non-book record index (偏移 80 from MOBI header start)
	if len(rec0) >= mobiStart+84 {
		book.firstResIdx = binary.BigEndian.Uint32(rec0[mobiStart+80 : mobiStart+84])
	}

	// 获取书名（从 MOBI 头部的 full name offset/length）
	if len(rec0) >= mobiStart+92 {
		fullNameOffset := binary.BigEndian.Uint32(rec0[mobiStart+84 : mobiStart+88])
		fullNameLength := binary.BigEndian.Uint32(rec0[mobiStart+88 : mobiStart+92])
		if fullNameOffset > 0 && fullNameLength > 0 && int(fullNameOffset+fullNameLength) <= len(rec0) {
			book.title = string(rec0[fullNameOffset : fullNameOffset+fullNameLength])
		}
	}

	// 检查 EXTH 标志（偏移 128 from MOBI header start）
	hasEXTH := false
	if len(rec0) >= mobiStart+132 {
		exthFlags := binary.BigEndian.Uint32(rec0[mobiStart+128 : mobiStart+132])
		hasEXTH = (exthFlags & 0x40) != 0
	}

	// 解析 EXTH 头部
	if hasEXTH {
		exthStart := mobiStart + 16 + int(book.mobiHeaderLen) - 16
		// MOBI header length 包含了 "MOBI" 魔数之后的长度
		// 实际 EXTH 位置 = 16 (PalmDOC) + mobiHeaderLen
		exthStart = 16 + int(book.mobiHeaderLen)
		if exthStart < len(rec0) {
			book.parseEXTH(rec0[exthStart:])
		}
	}

	// 如果 PDB 头部名称有内容且 title 为空，使用 PDB 名称
	if book.title == "" {
		name := strings.TrimRight(string(book.pdbHeader.Name[:]), "\x00")
		book.title = strings.TrimSpace(name)
	}

	return nil
}

// parseEXTH 解析 EXTH 扩展头部
func (book *mobiBook) parseEXTH(data []byte) {
	if len(data) < 12 {
		return
	}

	magic := string(data[0:4])
	if magic != mobiMagicEXTH {
		return
	}

	// headerLen := binary.BigEndian.Uint32(data[4:8])
	recordCount := binary.BigEndian.Uint32(data[8:12])

	offset := 12
	for i := uint32(0); i < recordCount && offset+8 <= len(data); i++ {
		recType := binary.BigEndian.Uint32(data[offset : offset+4])
		recLen := binary.BigEndian.Uint32(data[offset+4 : offset+8])

		if recLen < 8 || offset+int(recLen) > len(data) {
			break
		}

		recData := data[offset+8 : offset+int(recLen)]
		value := string(recData)

		switch recType {
		case exthAuthor:
			book.author = strings.TrimSpace(value)
		case exthPublisher:
			book.publisher = strings.TrimSpace(value)
		case exthDescription:
			book.description = strings.TrimSpace(value)
		case exthISBN:
			book.isbn = strings.TrimSpace(value)
		case exthSubject:
			if book.subject != "" {
				book.subject += ", "
			}
			book.subject += strings.TrimSpace(value)
		case exthDate:
			book.date = strings.TrimSpace(value)
		case exthTitle:
			if t := strings.TrimSpace(value); t != "" {
				book.title = t
			}
		case exthLanguage:
			book.language = strings.TrimSpace(value)
		case exthKF8Boundary:
			if len(recData) >= 4 {
				book.kf8Boundary = int(binary.BigEndian.Uint32(recData[0:4]))
			}
		}

		offset += int(recLen)
	}
}

// ============================================================
// 文本提取（PalmDOC 解压缩）
// ============================================================

// extractText 提取并解压缩所有文本记录
func (book *mobiBook) extractText() error {
	if book.textRecCount == 0 {
		return fmt.Errorf("no text records found")
	}

	var textBuf bytes.Buffer
	textBuf.Grow(int(book.textLength))

	for i := 1; i <= int(book.textRecCount); i++ {
		recData, err := book.getRecordData(i)
		if err != nil {
			log.Printf("[mobi] Warning: failed to read text record %d: %v", i, err)
			continue
		}

		var decompressed []byte
		switch book.compression {
		case palmDocNoCompression:
			decompressed = recData
		case palmDocPalmDOC:
			decompressed = palmDocDecompress(recData)
		case palmDocHuffCDIC:
			// HuffCDIC 压缩较复杂，尝试直接使用原始数据
			// 大多数现代 MOBI 文件使用 PalmDOC 压缩
			log.Printf("[mobi] Warning: HuffCDIC compression not fully supported, attempting raw extraction")
			decompressed = recData
		default:
			decompressed = recData
		}

		// 去除尾部的多余字节（trailing entries）
		decompressed = trimTrailingEntries(decompressed, book.fileData, i, book.records)

		textBuf.Write(decompressed)
	}

	rawText := textBuf.Bytes()

	// 根据编码转换为 UTF-8
	if book.encoding == mobiEncodingLatin1 || book.encoding == 0 {
		book.htmlContent = latin1ToUTF8(rawText)
	} else {
		// UTF-8 编码，直接使用
		book.htmlContent = string(rawText)
	}

	// 清理无效的 UTF-8 字符
	if !utf8.ValidString(book.htmlContent) {
		book.htmlContent = strings.ToValidUTF8(book.htmlContent, "")
	}

	return nil
}

// palmDocDecompress PalmDOC LZ77 解压缩
func palmDocDecompress(data []byte) []byte {
	var out bytes.Buffer
	i := 0
	dataLen := len(data)

	for i < dataLen {
		b := data[i]
		i++

		if b == 0 {
			// 字面量 0x00
			out.WriteByte(b)
		} else if b >= 1 && b <= 8 {
			// 接下来的 b 个字节是字面量
			count := int(b)
			for j := 0; j < count && i < dataLen; j++ {
				out.WriteByte(data[i])
				i++
			}
		} else if b >= 0x09 && b <= 0x7F {
			// 字面量字节
			out.WriteByte(b)
		} else if b >= 0x80 && b <= 0xBF {
			// LZ77 回溯引用：2 字节编码
			if i >= dataLen {
				break
			}
			next := data[i]
			i++

			// 距离和长度编码
			dist := (int(b)<<8 | int(next)) >> 3 & 0x7FF
			length := int(next)&0x07 + 3

			outBytes := out.Bytes()
			outLen := len(outBytes)
			for j := 0; j < length; j++ {
				pos := outLen - dist + j
				if pos >= 0 && pos < len(outBytes) {
					out.WriteByte(outBytes[pos])
					outBytes = out.Bytes()
				} else {
					out.WriteByte(' ')
				}
			}
		} else if b >= 0xC0 {
			// 空格 + 字符
			out.WriteByte(' ')
			out.WriteByte(b ^ 0x80)
		}
	}

	return out.Bytes()
}

// trimTrailingEntries 去除文本记录尾部的 trailing entries
// MOBI 格式在每个文本记录末尾可能有额外的字节用于索引
func trimTrailingEntries(data []byte, _ []byte, _ int, _ []palmDBRecord) []byte {
	// 简单策略：如果数据末尾有 0x00 填充，去除
	for len(data) > 0 && data[len(data)-1] == 0 {
		data = data[:len(data)-1]
	}
	return data
}

// latin1ToUTF8 将 Latin-1 编码转换为 UTF-8
func latin1ToUTF8(data []byte) string {
	var buf strings.Builder
	buf.Grow(len(data))
	for _, b := range data {
		buf.WriteRune(rune(b))
	}
	return buf.String()
}

// ============================================================
// 图片资源提取
// ============================================================

func (book *mobiBook) extractImages() {
	// 确定图片记录的起始索引
	startIdx := -1
	if book.firstImageIdx > 0 && int(book.firstImageIdx) < len(book.records) {
		startIdx = int(book.firstImageIdx)
	} else if book.firstResIdx > 0 && int(book.firstResIdx) < len(book.records) {
		startIdx = int(book.firstResIdx)
	} else if book.textRecCount > 0 && int(book.textRecCount)+1 < len(book.records) {
		startIdx = int(book.textRecCount) + 1
	}

	if startIdx <= 0 {
		return
	}

	endIdx := len(book.records)
	if book.kf8Boundary > 0 && book.kf8Boundary < endIdx {
		endIdx = book.kf8Boundary
	}

	imgIndex := 0
	for i := startIdx; i < endIdx; i++ {
		recData, err := book.getRecordData(i)
		if err != nil {
			continue
		}

		// 检测图片类型
		mimeType := detectImageType(recData)
		if mimeType == "" {
			continue
		}

		book.images = append(book.images, mobiImage{
			index:    imgIndex,
			data:     recData,
			mimeType: mimeType,
		})
		imgIndex++
	}
}

// detectImageType 通过魔数检测图片类型
func detectImageType(data []byte) string {
	if len(data) < 4 {
		return ""
	}

	// JPEG
	if data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg"
	}
	// PNG
	if data[0] == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G' {
		return "image/png"
	}
	// GIF
	if data[0] == 'G' && data[1] == 'I' && data[2] == 'F' {
		return "image/gif"
	}
	// BMP
	if data[0] == 'B' && data[1] == 'M' {
		return "image/bmp"
	}
	// WebP
	if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		return "image/webp"
	}

	return ""
}

// ============================================================
// 章节分割
// ============================================================

// mobiHTMLSplitRegex 用于分割 MOBI HTML 内容的正则
var mobiHTMLSplitRegex = regexp.MustCompile(`(?i)<mbp:pagebreak\s*/?>|<mbp:pagebreak[^>]*>`)

// mobiHeadingRegex 用于提取章节标题
var mobiHeadingRegex = regexp.MustCompile(`(?is)<h[1-3][^>]*>(.*?)</h[1-3]>`)

func (book *mobiBook) splitChapters() {
	html := book.htmlContent
	if html == "" {
		return
	}

	// 尝试使用 <mbp:pagebreak> 分割（MOBI 标准分页标记）
	parts := mobiHTMLSplitRegex.Split(html, -1)

	if len(parts) <= 1 {
		// 没有 pagebreak 标记，尝试用 <h1>/<h2> 分割
		parts = splitByHeadings(html)
	}

	if len(parts) <= 1 {
		// 仍然无法分割，作为单一章节处理
		sanitized := sanitizeMobiHTML(html)
		textContent := extractTextFromXHTML(html)
		if len(strings.TrimSpace(textContent)) == 0 && len(strings.TrimSpace(sanitized)) == 0 {
			return
		}
		book.chapters = []mobiChapter{{
			title:       book.title,
			htmlContent: sanitized,
			textContent: textContent,
		}}
		return
	}

	// 处理每个分割部分
	chapterIdx := 0
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if len(part) == 0 {
			continue
		}

		textContent := extractTextFromXHTML(part)
		if len(strings.TrimSpace(textContent)) == 0 {
			continue
		}

		// 提取章节标题
		title := ""
		if m := mobiHeadingRegex.FindStringSubmatch(part); len(m) > 1 {
			title = strings.TrimSpace(htmlTagRegex.ReplaceAllString(m[1], ""))
		}
		if title == "" {
			chapterIdx++
			title = fmt.Sprintf("第 %d 章", chapterIdx)
		} else {
			chapterIdx++
		}

		sanitized := sanitizeMobiHTML(part)

		book.chapters = append(book.chapters, mobiChapter{
			title:       title,
			htmlContent: sanitized,
			textContent: textContent,
		})
	}

	// 如果没有有效章节，将整个内容作为一个章节
	if len(book.chapters) == 0 {
		sanitized := sanitizeMobiHTML(html)
		textContent := extractTextFromXHTML(html)
		if len(strings.TrimSpace(textContent)) > 0 {
			book.chapters = []mobiChapter{{
				title:       book.title,
				htmlContent: sanitized,
				textContent: textContent,
			}}
		}
	}
}

// splitByHeadings 按 <h1>/<h2> 标签分割 HTML
func splitByHeadings(html string) []string {
	// 查找所有 <h1> 或 <h2> 的位置
	headingRegex := regexp.MustCompile(`(?i)<h[12][^>]*>`)
	locs := headingRegex.FindAllStringIndex(html, -1)

	if len(locs) < 2 {
		return []string{html}
	}

	var parts []string
	for i, loc := range locs {
		var end int
		if i+1 < len(locs) {
			end = locs[i+1][0]
		} else {
			end = len(html)
		}
		part := html[loc[0]:end]
		if len(strings.TrimSpace(part)) > 0 {
			parts = append(parts, part)
		}
	}

	// 如果第一个 heading 之前有内容，也加入
	if len(locs) > 0 && locs[0][0] > 0 {
		prefix := html[:locs[0][0]]
		if len(strings.TrimSpace(extractTextFromXHTML(prefix))) > 50 {
			parts = append([]string{prefix}, parts...)
		}
	}

	return parts
}

// sanitizeMobiHTML 清理 MOBI HTML 内容，使其适合在阅读器中渲染
func sanitizeMobiHTML(rawHTML string) string {
	html := rawHTML

	// 移除 MOBI 特有的标签
	mobiTagRegex := regexp.MustCompile(`(?i)</?mbp:[^>]*>`)
	html = mobiTagRegex.ReplaceAllString(html, "")

	// 移除 <guide>、<reference> 等导航标签
	guideRegex := regexp.MustCompile(`(?is)<guide[^>]*>.*?</guide>`)
	html = guideRegex.ReplaceAllString(html, "")

	// 提取 body 内容（如果有）
	bodyRegex := regexp.MustCompile(`(?is)<body[^>]*>(.*)</body>`)
	if m := bodyRegex.FindStringSubmatch(html); len(m) > 1 {
		html = m[1]
	}

	// 移除 script, style, head 等
	for _, tag := range []string{"script", "style", "head", "title", "noscript"} {
		re := regexp.MustCompile(`(?is)<` + tag + `[^>]*>.*?</` + tag + `>`)
		html = re.ReplaceAllString(html, "")
	}

	// 移除 class/style/id 属性
	attrRegex := regexp.MustCompile(`\s+(class|style|id|epub:type|xmlns[^=]*)\s*=\s*"[^"]*"`)
	html = attrRegex.ReplaceAllString(html, "")
	attrRegex2 := regexp.MustCompile(`\s+(class|style|id|epub:type|xmlns[^=]*)\s*=\s*'[^']*'`)
	html = attrRegex2.ReplaceAllString(html, "")

	// 移除 XML 声明
	xmlDeclRegex := regexp.MustCompile(`<\?[^?]*\?>`)
	html = xmlDeclRegex.ReplaceAllString(html, "")

	// 移除自闭合 meta/link
	selfCloseRegex := regexp.MustCompile(`(?i)<(meta|link)[^>]*/?>`)
	html = selfCloseRegex.ReplaceAllString(html, "")

	// 将 MOBI 图片引用 (recindex:XXXX) 转换为可识别的格式
	imgRecRegex := regexp.MustCompile(`(?i)(<img[^>]*\s+(?:src|recindex)\s*=\s*")(\d+)(")`)
	html = imgRecRegex.ReplaceAllStringFunc(html, func(match string) string {
		parts := imgRecRegex.FindStringSubmatch(match)
		if len(parts) < 4 {
			return match
		}
		return parts[1] + "recindex:" + parts[2] + parts[3]
	})

	// 解码 HTML 实体
	html = decodeHTMLEntities(html)

	// 清理多余空行
	html = multiNewline.ReplaceAllString(html, "\n\n")

	return strings.TrimSpace(html)
}

// ============================================================
// MOBI 内容类型检测（漫画 vs 小说）
// ============================================================

// IsMobiImageHeavy 检测 MOBI/AZW3 文件是否以图片为主
func IsMobiImageHeavy(filePath string) bool {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return false
	}

	book := &mobiBook{
		filePath:    filePath,
		fileData:    data,
		kf8Boundary: -1,
	}

	// 解析基本结构
	if err := book.parsePDBHeader(); err != nil {
		return false
	}
	if err := book.parsePDBRecords(); err != nil {
		return false
	}
	if err := book.parseRecord0(); err != nil {
		return false
	}

	// 统计图片记录数量
	imageCount := 0

	// 确定图片记录的起始索引
	startIdx := -1
	if book.firstImageIdx > 0 && int(book.firstImageIdx) < len(book.records) {
		startIdx = int(book.firstImageIdx)
	} else if book.firstResIdx > 0 && int(book.firstResIdx) < len(book.records) {
		// AZW3/KF8: 使用 first non-book record index
		startIdx = int(book.firstResIdx)
	} else if book.textRecCount > 0 && int(book.textRecCount)+1 < len(book.records) {
		// 回退: 文本记录之后即为资源记录
		startIdx = int(book.textRecCount) + 1
	}

	if startIdx > 0 {
		endIdx := len(book.records)
		if book.kf8Boundary > 0 && book.kf8Boundary < endIdx {
			endIdx = book.kf8Boundary
		}
		for i := startIdx; i < endIdx; i++ {
			recData, err := book.getRecordData(i)
			if err != nil {
				continue
			}
			if detectImageType(recData) != "" {
				imageCount++
			}
		}
	}

	// 提取文本长度
	textLen := int(book.textLength)

	// 补充检测：如果通过记录扫描未检测到图片，尝试提取 HTML 内容并统计 <img> 标签
	if imageCount == 0 {
		if err := book.extractText(); err == nil && book.htmlContent != "" {
			imgTagCount := strings.Count(strings.ToLower(book.htmlContent), "<img")
			if imgTagCount > 0 {
				imageCount = imgTagCount
				// HTML 中有 <img> 标签但未提取到实际图片数据，
				// 说明图片确实存在，使用标签数作为图片计数
			}
		}
	}

	log.Printf("[mobi] Image-heavy check for %s: images=%d, textLength=%d (startIdx=%d, firstImageIdx=%d, firstResIdx=%d, textRecCount=%d)",
		path.Base(filePath), imageCount, textLen, startIdx, book.firstImageIdx, book.firstResIdx, book.textRecCount)

	// textLength 包含 HTML 标记（<div><img src="..."/></div> 等），会大幅膨胀实际文本长度。
	// 漫画 AZW3 的 HTML 主要是 <img> 标签及少量包裹标签，每张图片约 300-600 字节 HTML；
	// 小说 AZW3 的 HTML 是大量段落文本，每张配图对应数千字符正文。
	// 因此使用分层阈值：
	//   - 图片数 >= 100：几乎一定是漫画卷（漫画通常 150-300 页）
	//   - 图片数 >= 20：每图平均文本 < 800 字符视为漫画
	//   - 图片数 >= 5：每图平均文本 < 200 字符视为漫画（严格模式，纯文字+少量插图）
	if imageCount >= 100 {
		return true
	}
	if imageCount >= 20 && textLen/imageCount < 800 {
		return true
	}
	if imageCount >= 5 && textLen/imageCount < 200 {
		return true
	}

	return false
}

// ============================================================
// MOBI 元数据提取
// ============================================================

// MobiMetadata MOBI 文件的元数据
type MobiMetadata struct {
	Title       string
	Author      string
	Publisher   string
	Description string
	ISBN        string
	Genre       string
	Date        string
	Language    string
}

// ExtractMobiMetadata 从 MOBI/AZW3 文件中提取元数据
func ExtractMobiMetadata(filePath string) (*MobiMetadata, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	book := &mobiBook{
		filePath:    filePath,
		fileData:    data,
		kf8Boundary: -1,
	}

	if err := book.parsePDBHeader(); err != nil {
		return nil, err
	}
	if err := book.parsePDBRecords(); err != nil {
		return nil, err
	}
	if err := book.parseRecord0(); err != nil {
		return nil, err
	}

	return &MobiMetadata{
		Title:       book.title,
		Author:      book.author,
		Publisher:   book.publisher,
		Description: book.description,
		ISBN:        book.isbn,
		Genre:       book.subject,
		Date:        book.date,
		Language:    book.language,
	}, nil
}

// ============================================================
// MOBI 封面图片提取（用于缩略图）
// ============================================================

// ExtractMobiCoverImage 从 MOBI/AZW3 文件中提取封面图片
func ExtractMobiCoverImage(filePath string) ([]byte, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	book := &mobiBook{
		filePath:    filePath,
		fileData:    data,
		kf8Boundary: -1,
	}

	if err := book.parsePDBHeader(); err != nil {
		return nil, err
	}
	if err := book.parsePDBRecords(); err != nil {
		return nil, err
	}
	if err := book.parseRecord0(); err != nil {
		return nil, err
	}

	// 提取第一张图片作为封面
	// 尝试多种起始索引
	coverStartIdx := -1
	if book.firstImageIdx > 0 && int(book.firstImageIdx) < len(book.records) {
		coverStartIdx = int(book.firstImageIdx)
	} else if book.firstResIdx > 0 && int(book.firstResIdx) < len(book.records) {
		coverStartIdx = int(book.firstResIdx)
	} else if book.textRecCount > 0 && int(book.textRecCount)+1 < len(book.records) {
		coverStartIdx = int(book.textRecCount) + 1
	}

	if coverStartIdx > 0 {
		endIdx := len(book.records)
		if book.kf8Boundary > 0 && book.kf8Boundary < endIdx {
			endIdx = book.kf8Boundary
		}
		for i := coverStartIdx; i < endIdx; i++ {
			recData, err := book.getRecordData(i)
			if err != nil {
				continue
			}
			if detectImageType(recData) != "" {
				return recData, nil
			}
		}
	}

	return nil, fmt.Errorf("no cover image found in MOBI file")
}

// ============================================================
// zlib 解压辅助（用于某些 KF8 资源）
// ============================================================

func zlibDecompress(data []byte) ([]byte, error) {
	r, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

// ============================================================
// MOBI Reader 接口适配（供 archive 包的其他函数使用）
// ============================================================

// GetMobiChapterTitles 获取 MOBI Reader 的章节标题
func GetMobiChapterTitles(r Reader) []string {
	if mr, ok := r.(*mobiReader); ok {
		return mr.GetChapterTitles()
	}
	return nil
}

// GetMobiCoverImage 从 MOBI Reader 获取封面图片
func GetMobiCoverImage(r Reader) ([]byte, error) {
	if mr, ok := r.(*mobiReader); ok {
		return mr.GetCoverImage()
	}
	return nil, fmt.Errorf("not a MOBI reader")
}

// CountMobiEmbeddedImages 返回 MOBI 内嵌图片数量。
func CountMobiEmbeddedImages(r Reader) int {
	if mr, ok := r.(*mobiReader); ok && mr.book != nil {
		return len(mr.book.images)
	}
	return 0
}

// GetMobiEmbeddedImageData 按索引提取 MOBI 内嵌图片。
func GetMobiEmbeddedImageData(r Reader, index int) ([]byte, string, error) {
	mr, ok := r.(*mobiReader)
	if !ok || mr.book == nil {
		return nil, "", fmt.Errorf("not a MOBI reader")
	}
	if index < 0 || index >= len(mr.book.images) {
		return nil, "", fmt.Errorf("image index %d out of range (0-%d)", index, len(mr.book.images)-1)
	}
	img := mr.book.images[index]
	mime := img.mimeType
	if mime == "" {
		mime = "image/jpeg"
	}
	return img.data, mime, nil
}
