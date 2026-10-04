package storage

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// uploadContentTypes are the extensions /api/files serves inline; anything
// else goes out as an octet-stream attachment so a browser never renders
// HTML or SVG from the app's origin.
var uploadContentTypes = map[string]string{
	"pdf":  "application/pdf",
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"jpeg": "image/jpeg",
	"webp": "image/webp",
}

// ServeUpload streams the file at abs with the headers of
// app/api/files/[bucket]/[...path]: an allow-listed Content-Type (else
// octet-stream + attachment), nosniff, public or private caching, and single
// Range requests. It returns os.ErrNotExist (or the stat error) without
// writing anything when abs is not a regular file, so the caller renders its
// own 404.
func ServeUpload(w http.ResponseWriter, r *http.Request, abs string, public bool) error {
	f, err := os.Open(abs)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() {
		return os.ErrNotExist
	}

	h := w.Header()
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(abs), "."))
	if ct, ok := uploadContentTypes[ext]; ok {
		h.Set("Content-Type", ct)
	} else {
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", "attachment")
	}
	h.Set("X-Content-Type-Options", "nosniff")
	if public {
		h.Set("Cache-Control", "public, max-age=86400")
	} else {
		h.Set("Cache-Control", "private, max-age=300")
		h.Set("Vary", "Cookie, Authorization")
	}
	h.Set("Accept-Ranges", "bytes")

	size := st.Size()
	if start, end, ok := parseRange(r.Header.Get("Range"), size); ok {
		h.Set("Content-Range", "bytes "+strconv.FormatInt(start, 10)+"-"+strconv.FormatInt(end, 10)+"/"+strconv.FormatInt(size, 10))
		h.Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		if _, err := f.Seek(start, io.SeekStart); err != nil {
			return nil
		}
		_, _ = io.CopyN(w, f, end-start+1)
		return nil
	}
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
	return nil
}

var rangeRe = regexp.MustCompile(`^bytes=(\d*)-(\d*)$`)

// parseRange is the route's parseRange: one "bytes=a-b", "bytes=a-" or
// "bytes=-n" range clamped to the file; anything else (or an unsatisfiable
// range) serves the whole file.
func parseRange(header string, size int64) (int64, int64, bool) {
	m := rangeRe.FindStringSubmatch(strings.TrimSpace(header))
	if m == nil {
		return 0, 0, false
	}
	var start, end int64
	switch {
	case m[1] != "":
		start, _ = strconv.ParseInt(m[1], 10, 64)
		end = size - 1
		if m[2] != "" {
			end, _ = strconv.ParseInt(m[2], 10, 64)
		}
	case m[2] != "":
		n, _ := strconv.ParseInt(m[2], 10, 64)
		start, end = max(0, size-n), size-1
	default:
		return 0, 0, false
	}
	if start > end || start >= size {
		return 0, 0, false
	}
	return start, min(end, size-1), true
}

// WritePrivateFile writes a private file the way the authenticated file
// routes do: Content-Type (application/octet-stream when empty),
// Cache-Control, nosniff, and Content-Disposition when given.
// cacheControl is "private, max-age=300" for the recruitment files,
// "private, max-age=3600" for HRIS and finance documents and
// "private, no-store" for the data room.
func WritePrivateFile(w http.ResponseWriter, data []byte, mime, cacheControl, disposition string) {
	if mime == "" {
		mime = "application/octet-stream"
	}
	h := w.Header()
	h.Set("Content-Type", mime)
	if disposition != "" {
		h.Set("Content-Disposition", disposition)
	}
	h.Set("Cache-Control", cacheControl)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// ContentDisposition is contentDisposition in lib/dataroom/api.ts: an ASCII
// fallback name plus the UTF-8 name per RFC 5987.
func ContentDisposition(name string, inline bool) string {
	ascii := strings.NewReplacer(`"`, "_", `\`, "_").Replace(ReplaceNonPrintableASCII(name, "_"))
	kind := "attachment"
	if inline {
		kind = "inline"
	}
	return kind + `; filename="` + ascii + `"; filename*=UTF-8''` + EncodeURIComponent(name)
}

// MustForceAttachment is mustForceAttachment: MIME types never served
// inline (HTML, SVG, XML, JavaScript).
func MustForceAttachment(mime string) bool {
	m := strings.ToLower(mime)
	return strings.Contains(m, "html") || strings.Contains(m, "svg") || strings.Contains(m, "xml") || strings.Contains(m, "javascript")
}

// ReplaceNonPrintableASCII is JavaScript's s.replace(/[^\x20-\x7e]/g, repl):
// every UTF-16 code unit outside printable ASCII becomes repl, so a
// character outside the BMP (a surrogate pair) becomes two.
func ReplaceNonPrintableASCII(s, repl string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 0x20 && r <= 0x7e:
			b.WriteRune(r)
		case r > 0xffff:
			b.WriteString(repl + repl)
		default:
			b.WriteString(repl)
		}
	}
	return b.String()
}
