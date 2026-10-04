package storage

import (
	"errors"
	"os"
	"path"
	"regexp"
	"strings"
)

// MaxFileSize and AllowedTypes are validateFile's limits in lib/storage.ts.
const MaxFileSize = 10 * 1024 * 1024

// AllowedTypes are the MIME types validateFile accepts.
var AllowedTypes = []string{
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

// mimeExtensions derives the stored extension from the validated MIME type,
// never from the client's file name (an "evil.svg" sent as image/png).
var mimeExtensions = map[string]string{
	"application/pdf":    "pdf",
	"image/jpeg":         "jpg",
	"image/png":          "png",
	"image/webp":         "webp",
	"image/heic":         "heic",
	"application/msword": "doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}

var shortExt = regexp.MustCompile(`^[a-zA-Z0-9]{1,5}$`)

// SafeExtension is safeExtension: the extension for mime, else the file
// name's extension when it is 1-5 alphanumerics, else "bin".
func SafeExtension(mime, fileName string) string {
	if ext, ok := mimeExtensions[mime]; ok {
		return ext
	}
	raw := fileName[strings.LastIndex(fileName, ".")+1:]
	if shortExt.MatchString(raw) {
		return strings.ToLower(raw)
	}
	return "bin"
}

// ValidateFile is validateFile: nil, or the TS message for a file that is
// too large or of an unsupported type.
func ValidateFile(size int64, mime string) error {
	if size > MaxFileSize {
		return errors.New("Ukuran file maksimal 10 MB")
	}
	for _, t := range AllowedTypes {
		if t == mime {
			return nil
		}
	}
	return errors.New("Tipe file tidak didukung")
}

// Access says who may read a bucket through /api/files.
type Access string

const (
	// AccessPublic buckets are read anonymously (product and ticket images,
	// static QRIS, desktop wallpapers, CRM announcements and avatars).
	AccessPublic Access = "public"
	// AccessMemberOwned is member-photos: a member reads member-photos/<own
	// customer id>/..., staff read all.
	AccessMemberOwned Access = "member-owned"
	// AccessStaff is everything else, unknown buckets included.
	AccessStaff Access = "staff"
)

var publicBuckets = map[string]bool{
	"products":           true,
	"ticketing":          true,
	"payment-qris":       true,
	"desktop-wallpapers": true,
	"crm-announcements":  true,
	"crm-avatars":        true,
}

// BucketAccess is bucketAccess in lib/storage.ts.
func BucketAccess(bucket string) Access {
	switch {
	case publicBuckets[bucket]:
		return AccessPublic
	case bucket == "member-photos":
		return AccessMemberOwned
	default:
		return AccessStaff
	}
}

// PublicURL is getPublicUrl: /api/files/<bucket>/<each segment encoded>.
func PublicURL(bucket, filePath string) string {
	parts := strings.Split(filePath, "/")
	for i, p := range parts {
		parts[i] = EncodeURIComponent(p)
	}
	return "/api/files/" + bucket + "/" + strings.Join(parts, "/")
}

// Upload is uploadFile: it writes data to uploads/<bucket>/[<folder>/]
// <ms>-<token>.<ext> and returns its /api/files URL. The extension comes
// from SafeExtension(mime, fileName); pass an empty mime and fileName for
// raw bytes, which uploadFile stores as .bin.
func (s *Store) Upload(bucket, folder string, data []byte, mime, fileName string) (string, error) {
	if bucket == "" || strings.Contains(bucket, "/") {
		return "", ErrInvalidPath
	}
	name := s.timedName(16, SafeExtension(mime, fileName))
	if folder != "" {
		name = folder + "/" + name
	}
	abs, ok := within(s.UploadsDir(), path.Join(bucket, name))
	if !ok {
		return "", ErrInvalidPath
	}
	if err := writeFile(abs, data); err != nil {
		return "", err
	}
	return PublicURL(bucket, name), nil
}

// Delete is deleteFile: it removes the file behind an /api/files/<bucket>/
// URL (the URL may carry an origin).
func (s *Store) Delete(bucket, fileURL string) error {
	abs, err := s.uploadPathIn(bucket, fileURL)
	if err != nil {
		return err
	}
	return os.Remove(abs)
}

func (s *Store) uploadPathIn(bucket, fileURL string) (string, error) {
	prefix := "/api/files/" + bucket + "/"
	idx := strings.Index(fileURL, prefix)
	if idx < 0 {
		return "", errors.New("Invalid file URL")
	}
	rel, err := DecodeURIComponent(fileURL[idx+len(prefix):])
	if err != nil {
		return "", errors.New("Invalid file URL")
	}
	abs, ok := within(s.UploadsDir(), path.Join(bucket, rel))
	if !ok {
		return "", ErrInvalidPath
	}
	return abs, nil
}

var fileURLRe = regexp.MustCompile(`/api/files/([^/]+)/(.+)$`)

// UploadPath is cvUrlToDiskPath: the absolute path behind an /api/files URL,
// or false when the URL does not point inside uploads/.
func (s *Store) UploadPath(fileURL string) (string, bool) {
	m := fileURLRe.FindStringSubmatch(fileURL)
	if m == nil {
		return "", false
	}
	bucket, err := DecodeURIComponent(m[1])
	if err != nil {
		return "", false
	}
	segs := strings.Split(m[2], "/")
	for i, seg := range segs {
		if segs[i], err = DecodeURIComponent(seg); err != nil {
			return "", false
		}
	}
	return within(s.UploadsDir(), path.Join(append([]string{bucket}, segs...)...))
}

// UploadFile resolves the /api/files/<bucket>/<segments...> route params to
// a path under uploads/, with the checks of that route: safe segments and
// containment. false means 404.
func (s *Store) UploadFile(bucket string, segments []string) (string, bool) {
	b := SafeSegments([]string{bucket})
	segs := SafeSegments(segments)
	if b == nil || segs == nil {
		return "", false
	}
	return within(s.UploadsDir(), path.Join(append(b, segs...)...))
}
