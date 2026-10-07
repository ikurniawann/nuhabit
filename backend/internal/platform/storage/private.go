package storage

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Content sniffing, as in storage-private.ts: the MIME a client claims can
// be forged, so the bytes decide.

var (
	pngMagic  = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	ebmlMagic = []byte{0x1a, 0x45, 0xdf, 0xa3}
)

// SniffImage is sniffImageMime: image/jpeg, image/png, image/webp or "".
func SniffImage(b []byte) string {
	switch {
	case len(b) < 12:
		return ""
	case b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff:
		return "image/jpeg"
	case bytes.Equal(b[:8], pngMagic):
		return "image/png"
	case string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	}
	return ""
}

// SniffDocument is sniffDocumentMime: application/pdf for "%PDF-", else
// SniffImage.
func SniffDocument(b []byte) string {
	if bytes.HasPrefix(b, []byte("%PDF-")) {
		return "application/pdf"
	}
	return SniffImage(b)
}

// SniffAudio is sniffAudioMime: webm (EBML), ogg, mp3 (ID3 or frame sync),
// mp4/m4a (ftyp), else "".
func SniffAudio(b []byte) string {
	switch {
	case len(b) < 12:
		return ""
	case bytes.HasPrefix(b, ebmlMagic):
		return "audio/webm"
	case string(b[:4]) == "OggS":
		return "audio/ogg"
	case string(b[:3]) == "ID3", b[0] == 0xff && b[1]&0xe0 == 0xe0:
		return "audio/mpeg"
	case string(b[4:8]) == "ftyp":
		return "audio/mp4"
	}
	return ""
}

var imageExt = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

var audioExt = map[string]string{
	"audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
}

// IsAllowedImageMime is isAllowedImageMime: jpeg, png or webp.
func IsAllowedImageMime(mime string) bool { _, ok := imageExt[mime]; return ok }

var unsafeFolderChars = regexp.MustCompile(`[^a-zA-Z0-9/_-]`)

// savePrivate writes data under private/<folder>/<ms>-<16 hex>.<ext> and
// returns the path relative to private/.
func (s *Store) savePrivate(data []byte, folder, ext string) (string, error) {
	rel := path.Join(unsafeFolderChars.ReplaceAllString(folder, ""), s.timedName(8, ext))
	if err := s.WritePrivate(rel, data); err != nil {
		return "", err
	}
	return rel, nil
}

// SavePrivateImage is savePrivateImage: the bytes must sniff as JPEG, PNG
// or WebP and declaredMime must be one of those.
func (s *Store) SavePrivateImage(data []byte, declaredMime, folder string) (string, error) {
	sniffed := SniffImage(data)
	if sniffed == "" || !IsAllowedImageMime(declaredMime) {
		return "", errors.New("Isi file bukan gambar JPG/PNG/WebP yang valid")
	}
	return s.savePrivate(data, folder, imageExt[sniffed])
}

// SavePrivateDocument is savePrivateDocument: PDF, JPEG, PNG or WebP by
// sniffing alone; the client's MIME is ignored.
func (s *Store) SavePrivateDocument(data []byte, folder string) (string, error) {
	sniffed := SniffDocument(data)
	if sniffed == "" {
		return "", errors.New("Isi file bukan PDF/JPG/PNG/WebP yang valid")
	}
	ext := imageExt[sniffed]
	if sniffed == "application/pdf" {
		ext = "pdf"
	}
	return s.savePrivate(data, folder, ext)
}

// SavePrivateAudio is savePrivateAudio: the extension comes from SniffAudio.
func (s *Store) SavePrivateAudio(data []byte, folder string) (string, error) {
	sniffed := SniffAudio(data)
	if sniffed == "" {
		return "", errors.New("Isi file bukan audio webm/ogg/mp3/m4a yang valid")
	}
	return s.savePrivate(data, folder, audioExt[sniffed])
}

// PrivatePath resolves rel under private/, false when it escapes.
func (s *Store) PrivatePath(rel string) (string, bool) { return within(s.PrivateDir(), rel) }

// WritePrivate writes data at private/<rel>, for callers that name files
// themselves (dataroom/YYYY/MM/<24 hex>.<ext>).
func (s *Store) WritePrivate(rel string, data []byte) error {
	abs, ok := s.PrivatePath(rel)
	if !ok {
		return ErrInvalidPath
	}
	return writeFile(abs, data)
}

// AppendPrivateChunk is appendPrivateChunk: the first chunk of a file must
// start with the EBML (webm) magic, and the file may not grow past maxBytes.
// It returns the size after the append.
func (s *Store) AppendPrivateChunk(rel string, data []byte, maxBytes int64) (int64, error) {
	abs, ok := s.PrivatePath(rel)
	if !ok {
		return 0, ErrInvalidPath
	}
	var current int64
	if st, err := os.Stat(abs); err == nil {
		current = st.Size()
	} else if !bytes.HasPrefix(data, ebmlMagic) {
		return 0, errors.New("Chunk pertama bukan webm valid")
	}
	if current+int64(len(data)) > maxBytes {
		return 0, errors.New("Kuota rekaman sesi tercapai")
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return 0, err
	}
	f, err := os.OpenFile(abs, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return 0, err
	}
	return current + int64(len(data)), f.Close()
}

// PrivateEntry is one file of ListPrivate.
type PrivateEntry struct {
	Name       string    `json:"name"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
}

// ListPrivate is listPrivateFiles: the regular files directly in relDir,
// sorted by name; empty on any error.
func (s *Store) ListPrivate(relDir string) []PrivateEntry {
	abs, ok := s.PrivatePath(relDir)
	if !ok {
		return nil
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil
	}
	out := []PrivateEntry{}
	for _, e := range entries {
		info, err := os.Stat(filepath.Join(abs, e.Name()))
		if err == nil && info.Mode().IsRegular() {
			out = append(out, PrivateEntry{Name: e.Name(), Size: info.Size(), ModifiedAt: info.ModTime()})
		}
	}
	// localeCompare: case-insensitive, lowercase first on ties.
	sort.SliceStable(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if a != b {
			return a < b
		}
		return out[i].Name > out[j].Name
	})
	return out
}

// DeletePrivate is deletePrivateFile (best effort).
func (s *Store) DeletePrivate(rel string) {
	if abs, ok := s.PrivatePath(rel); ok {
		_ = os.Remove(abs)
	}
}

// DeletePrivateFolder is deletePrivateFolder (recursive, best effort).
func (s *Store) DeletePrivateFolder(relDir string) {
	if abs, ok := s.PrivatePath(relDir); ok {
		_ = os.RemoveAll(abs)
	}
}

// ReadPrivate is readPrivateFile: the bytes and the MIME type mapped from
// the extension (PrivateMime). A missing file or escaping path is
// fs.ErrNotExist.
func (s *Store) ReadPrivate(rel string) ([]byte, string, error) {
	abs, ok := s.PrivatePath(rel)
	if !ok {
		return nil, "", fs.ErrNotExist
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, "", err
	}
	return data, PrivateMime(abs), nil
}

// PrivateMime maps a private file's extension the way readPrivateFile does:
// pdf, jpg/jpeg, png, webp, then webm/ogg/mp3/m4a as audio, else
// application/octet-stream.
func PrivateMime(name string) string {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(name), ".")) {
	case "pdf":
		return "application/pdf"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "webm":
		return "audio/webm"
	case "ogg":
		return "audio/ogg"
	case "mp3":
		return "audio/mpeg"
	case "m4a":
		return "audio/mp4"
	}
	return "application/octet-stream"
}
