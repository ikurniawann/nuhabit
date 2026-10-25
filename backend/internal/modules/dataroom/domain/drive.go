package domain

import (
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// Rules added for the Drive replacement: tags, search terms, folder paths
// and which files preview or feed the search index.

// MaxTags is how many tags a node keeps; MaxTagLen is each tag's length.
const (
	MaxTags   = 20
	MaxTagLen = 40
)

// NormalizeTags trims, lower-cases, drops empties and duplicates, and
// keeps at most MaxTags of at most MaxTagLen characters.
func NormalizeTags(list []string) []string {
	out := []string{}
	for _, raw := range list {
		t := strings.ToLower(validate.JSTrim(controlChars.ReplaceAllString(raw, "")))
		t = JSSlice(strings.Join(strings.Fields(t), " "), MaxTagLen)
		if t == "" || contains(out, t) {
			continue
		}
		out = append(out, t)
		if len(out) == MaxTags {
			break
		}
	}
	return out
}

var termChars = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// SearchTerms turns a free query into prefix tsquery lexemes ("nera" to
// "nera:*"), at most eight, letters and digits only.
func SearchTerms(q string) []string {
	out := []string{}
	for _, w := range termChars.Split(strings.ToLower(q), -1) {
		if w == "" || contains(out, w+":*") {
			continue
		}
		out = append(out, w+":*")
		if len(out) == 8 {
			break
		}
	}
	return out
}

// FolderPathSegments splits "Payroll/Slip Gaji/2026" into sanitized folder
// names, skipping empty parts.
func FolderPathSegments(path string) []string {
	out := []string{}
	for _, part := range strings.Split(strings.ReplaceAll(path, `\`, "/"), "/") {
		if validate.JSTrim(part) == "" {
			continue
		}
		out = append(out, SanitizeNodeName(part))
	}
	return out
}

// IsMediaPreview is video and audio the browser plays with Range requests.
func IsMediaPreview(mime string) bool {
	switch mime {
	case "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm":
		return true
	}
	return false
}

// IsTextPreview is text the dialog renders as plain text (served as
// text/plain so a browser never interprets it).
func IsTextPreview(mime string) bool {
	switch mime {
	case "text/plain", "text/markdown", "text/csv", "application/json":
		return true
	}
	return false
}

// IsOfficeDocument is a Word, Excel or PowerPoint file; without LibreOffice
// in the container the preview shows extracted text and a download button.
func IsOfficeDocument(mime string) bool {
	switch mime {
	case "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return true
	}
	return false
}

// MaxExtractBytes caps the file size read for the search index.
const MaxExtractBytes = 10 * 1024 * 1024

// IsExtractable is a file whose text the search index reads.
func IsExtractable(mime string) bool {
	switch mime {
	case "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel":
		return true
	}
	return IsTextPreview(mime)
}

// TrashRetentionDays is how long a trashed item waits before the purge.
const TrashRetentionDays = 30
