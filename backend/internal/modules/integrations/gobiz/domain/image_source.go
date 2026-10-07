package domain

import (
	"encoding/base64"
	"regexp"
	"strings"
)

var imageToken = regexp.MustCompile(`^[A-Za-z0-9_-]{4,400}$`)

// DecodeImageSource is decodeImageSource: the photo path a converter URL
// token names, or "" when the token is malformed or the path is not one of
// our own photos.
func DecodeImageSource(token string) string {
	if !imageToken.MatchString(token) {
		return ""
	}
	// Buffer.from(token, "base64url") drops a dangling sixth-bit character.
	if len(token)%4 == 1 {
		token = token[:len(token)-1]
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return ""
	}
	src := strings.ToValidUTF8(string(raw), "�")
	if !isConvertibleImageSource(src) {
		return ""
	}
	return src
}
