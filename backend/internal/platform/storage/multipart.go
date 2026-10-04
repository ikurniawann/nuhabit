package storage

import (
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"
)

// MaxRequestBytes is the body Next's proxy buffers before forwarding
// (proxyClientMaxBodySize, 10 MB). Routes that read the form themselves in
// Next have no lower limit, so a Go port passes this unless the TS route
// checks Content-Length first (assertBodySize).
const MaxRequestBytes = 10 << 20

var (
	// ErrInvalidForm is request.formData() rejecting: not multipart, a
	// broken body, or no boundary. Each route renders its own message.
	ErrInvalidForm = errors.New("invalid multipart form")
	// ErrBodyTooLarge is a body over the limit passed to ReadForm.
	ErrBodyTooLarge = errors.New("request body too large")
)

// File is one file part, shaped like the web File request.formData()
// yields: Type is the part's Content-Type lowercased, "text/plain" when
// absent and "" when it holds non-printable-ASCII characters.
type File struct {
	Name string
	Type string
	Data []byte
}

// Size is File.size.
func (f *File) Size() int64 { return int64(len(f.Data)) }

// Form is a parsed multipart/form-data body held in memory, as Next does.
type Form struct {
	values map[string][]string
	files  map[string][]*File
}

// Value is form.get(name) for a text field ("" when missing or a file).
func (f *Form) Value(name string) string {
	if v := f.values[name]; len(v) > 0 {
		return v[0]
	}
	return ""
}

// File is form.get(name) instanceof File: the first file part, or nil.
func (f *Form) File(name string) *File {
	if v := f.files[name]; len(v) > 0 {
		return v[0]
	}
	return nil
}

// ReadForm parses a multipart/form-data body of at most maxBytes into
// memory. A part with a filename parameter (even empty) is a file, the rest
// are text fields, matching undici's formData().
func ReadForm(r *http.Request, maxBytes int64) (*Form, error) {
	if r.ContentLength > maxBytes {
		return nil, ErrBodyTooLarge
	}
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		return nil, ErrInvalidForm
	}
	body := http.MaxBytesReader(nil, r.Body, maxBytes)
	mr := multipart.NewReader(body, params["boundary"])
	form := &Form{values: map[string][]string{}, files: map[string][]*File{}}
	for {
		part, err := mr.NextRawPart()
		if errors.Is(err, io.EOF) {
			return form, nil
		}
		if err != nil {
			return nil, formErr(err)
		}
		disposition, dparams, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		if err != nil || disposition != "form-data" {
			return nil, ErrInvalidForm
		}
		data, err := io.ReadAll(part)
		if err != nil {
			return nil, formErr(err)
		}
		name := dparams["name"]
		filename, isFile := dparams["filename"]
		if !isFile {
			form.values[name] = append(form.values[name], string(data))
			continue
		}
		form.files[name] = append(form.files[name], &File{Name: filename, Type: fileType(part.Header), Data: data})
	}
}

func formErr(err error) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return ErrBodyTooLarge
	}
	return ErrInvalidForm
}

// fileType applies the File constructor's type rules to the part header.
func fileType(h map[string][]string) string {
	v, ok := h["Content-Type"]
	if !ok || len(v) == 0 {
		return "text/plain"
	}
	for _, c := range v[0] {
		if c < 0x20 || c > 0x7e {
			return ""
		}
	}
	return strings.ToLower(v[0])
}
