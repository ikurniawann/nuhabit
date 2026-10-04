// Package storage reads and writes the files Next keeps under its storage
// directory, with the layout, names and checks of frontend/src/lib/storage.ts
// and storage-private.ts, so either app reads what the other wrote.
//
//	<root>/uploads/<bucket>/[<folder>/]<ms>-<32 hex>.<ext>   served by /api/files
//	<root>/private/<folder>/<ms>-<16 hex>.<ext>             served by authed routes
//
// root is STORAGE_DIR: /app/storage in both containers (process.cwd()/storage
// for Next), ../frontend/storage from a backend checkout.
package storage

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// ErrInvalidPath is returned for a path that escapes its root.
var ErrInvalidPath = errors.New("Path tidak valid")

// Store is the storage root shared with Next.
type Store struct {
	root string
	now  func() time.Time
}

// New returns a store rooted at dir.
func New(dir string) *Store { return &Store{root: dir, now: time.Now} }

// FromEnv returns the store at STORAGE_DIR, or the frontend's storage next to
// the backend checkout when it is unset.
func FromEnv() *Store { return New(Dir(os.Getenv)) }

// Dir resolves the storage root from getenv.
func Dir(getenv func(string) string) string {
	if d := strings.TrimSpace(getenv("STORAGE_DIR")); d != "" {
		return d
	}
	return filepath.Join(backendRoot(), "..", "frontend", "storage")
}

// backendRoot is the nearest directory above the working directory holding
// go.mod, else the working directory.
func backendRoot() string {
	cwd, _ := os.Getwd()
	for d := cwd; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "go.mod")); err == nil {
			return d
		}
		if filepath.Dir(d) == d {
			return cwd
		}
	}
}

// UploadsDir is <root>/uploads, the public /api/files tree.
func (s *Store) UploadsDir() string { return filepath.Join(s.root, "uploads") }

// PrivateDir is <root>/private, served only by authenticated routes.
func (s *Store) PrivateDir() string { return filepath.Join(s.root, "private") }

// within joins rel under base and reports whether the result stays strictly
// inside base, like path.resolve(base, rel).startsWith(base + sep).
func within(base, rel string) (string, bool) {
	baseAbs, err := filepath.Abs(base)
	if err != nil {
		return "", false
	}
	abs := filepath.Join(baseAbs, filepath.FromSlash(rel))
	return abs, strings.HasPrefix(abs, baseAbs+string(filepath.Separator))
}

// writeFile creates parent directories and writes data, as fs.mkdir
// recursive + fs.writeFile do under the containers' umask 022.
func writeFile(abs string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, data, 0o644)
}

// timedName is `${Date.now()}-${randomBytes(n).hex}.${ext}`.
func (s *Store) timedName(randomBytes int, ext string) string {
	return strconv.FormatInt(s.now().UnixMilli(), 10) + "-" + randomHex(randomBytes) + "." + ext
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// RandomFileToken is randomFileToken: 128 random bits as 32 hex characters.
func RandomFileToken() string { return randomHex(16) }

// SafeSegments is safeSegments in lib/security/safe-path.ts: every segment
// is decoded once more (catching %252F) and rejected when empty, starting
// with ".", or holding "/", "\" or NUL. nil means reject.
func SafeSegments(segments []string) []string {
	if len(segments) == 0 {
		return nil
	}
	out := make([]string, 0, len(segments))
	for _, raw := range segments {
		seg, err := DecodeURIComponent(raw)
		if err != nil || seg == "" || strings.HasPrefix(seg, ".") || strings.ContainsAny(seg, "/\\\x00") {
			return nil
		}
		out = append(out, seg)
	}
	return out
}

// SafeSegmentsUnder is safeSegmentsUnder: safe segments that start with
// folder and number at least minLength (folder included).
func SafeSegmentsUnder(segments []string, folder string, minLength int) []string {
	safe := SafeSegments(segments)
	if len(safe) < minLength || safe[0] != folder {
		return nil
	}
	return safe
}

// EncodeURIComponent is JavaScript's encodeURIComponent.
func EncodeURIComponent(s string) string {
	const keep = "-_.!~*'()"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte(keep, c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteString(strings.ToUpper(hex.EncodeToString([]byte{c})))
	}
	return b.String()
}

// DecodeURIComponent is JavaScript's decodeURIComponent: "+" stays "+", and
// a malformed escape or invalid UTF-8 is an error.
func DecodeURIComponent(s string) (string, error) {
	out, err := url.PathUnescape(s)
	if err == nil && !utf8.ValidString(out) {
		err = errors.New("URI malformed")
	}
	return out, err
}
