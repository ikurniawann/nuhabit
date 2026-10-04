package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// File rules of lib/dataroom/config.ts and storage.ts: MIME types, the
// extension a stored file gets, which files preview or take a watermark,
// and the quota message.

// extMimes is EXT_MIME in its key order: ExtensionForStorage picks the
// first extension listed for a MIME type (jpg before jpeg, tif before tiff).
var extMimes = []struct{ ext, mime string }{
	{"pdf", "application/pdf"},
	{"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"}, {"png", "image/png"}, {"webp", "image/webp"},
	{"gif", "image/gif"}, {"heic", "image/heic"}, {"bmp", "image/bmp"}, {"tif", "image/tiff"}, {"tiff", "image/tiff"},
	{"doc", "application/msword"},
	{"docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	{"xls", "application/vnd.ms-excel"},
	{"xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
	{"csv", "text/csv"},
	{"ppt", "application/vnd.ms-powerpoint"},
	{"pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
	{"txt", "text/plain"}, {"md", "text/markdown"}, {"json", "application/json"},
	{"zip", "application/zip"}, {"rar", "application/vnd.rar"}, {"7z", "application/x-7z-compressed"},
	{"mp4", "video/mp4"}, {"mov", "video/quicktime"}, {"webm", "video/webm"},
	{"mp3", "audio/mpeg"}, {"m4a", "audio/mp4"}, {"wav", "audio/wav"}, {"ogg", "audio/ogg"},
}

var extRe = regexp.MustCompile(`^[A-Za-z0-9]{1,6}$`)

// ExtensionOf is extensionOf: the lower-cased extension after the last dot
// when it is 1-6 alphanumerics, else "".
func ExtensionOf(name string) string {
	i := strings.LastIndex(name, ".")
	if i < 0 || !extRe.MatchString(name[i+1:]) {
		return ""
	}
	return strings.ToLower(name[i+1:])
}

// MimeFromExtension is mimeFromExtension: "" for an unknown extension.
func MimeFromExtension(name string) string {
	ext := ExtensionOf(name)
	for _, e := range extMimes {
		if e.ext == ext {
			return e.mime
		}
	}
	return ""
}

// ExtensionForStorage is extensionForStorage: the extension for mime, then
// the name's own, then "bin".
func ExtensionForStorage(mime, name string) string {
	for _, e := range extMimes {
		if e.mime == mime {
			return e.ext
		}
	}
	if ext := ExtensionOf(name); ext != "" {
		return ext
	}
	return "bin"
}

var claimedMimeRe = regexp.MustCompile(`^[a-z0-9.+-]+/[a-z0-9.+-]+$`)

// ResolveMime is resolveMime: the sniffed type (PDF or image), then the
// name's extension, then the client's claim when it looks like a MIME type.
func ResolveMime(data []byte, name, claimed string) string {
	if m := storage.SniffDocument(data); m != "" {
		return m
	}
	if m := MimeFromExtension(name); m != "" {
		return m
	}
	if c := strings.ToLower(validate.JSTrim(claimed)); claimedMimeRe.MatchString(c) {
		return c[:min(len(c), 150)]
	}
	return "application/octet-stream"
}

var imageMimeRe = regexp.MustCompile(`^image/(jpeg|png|webp|gif|bmp|tiff)$`)

// IsPreviewable is isPreviewable: images and PDF may open inline.
func IsPreviewable(mime string) bool {
	return imageMimeRe.MatchString(mime) || mime == "application/pdf"
}

// IsWatermarkable is isWatermarkable: JPEG, PNG, WebP and PDF.
func IsWatermarkable(mime string) bool {
	switch mime {
	case "image/jpeg", "image/png", "image/webp", "application/pdf":
		return true
	}
	return false
}

// FitsQuota is fitsQuota.
func FitsQuota(used, incoming, quota float64) bool { return used+incoming <= quota }

// FormatBytes is formatBytes: "512 B", "1.5 KB", "50 GB".
func FormatBytes(n float64) string {
	if n < 1024 {
		return validate.JSNumber(n) + " B"
	}
	units := []string{"KB", "MB", "GB", "TB"}
	v, i := n/1024, 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	if v < 10 {
		// toFixed(1) rounds a tie up; v*10 is exact for a byte count.
		return strconv.FormatFloat(math.Floor(float64(v*10)+0.5)/10, 'f', 1, 64) + " " + units[i]
	}
	return validate.JSNumber(jsmath.Round(v)) + " " + units[i]
}
