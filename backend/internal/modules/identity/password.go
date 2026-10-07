package identity

import (
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost is bcryptjs.hash(password, 10) in lib/auth/password.ts.
const bcryptCost = 10

// bcrypt reads at most 72 bytes of a password; bcryptjs drops the rest
// silently, x/crypto refuses to hash a longer one.
const bcryptMaxBytes = 72

// verifyPassword is verifyPassword: an empty hash never matches. bcryptjs
// accepts $2a$, $2b$ and $2y$ hashes and so does x/crypto.
func verifyPassword(password, hash string) bool {
	if hash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// hashPassword is hashPassword. The prefix is rewritten to $2b$, the version
// bcryptjs 3 writes, so Go-written hashes look like TS-written ones (the two
// versions hash a password under 255 bytes identically).
func hashPassword(password string) (string, error) {
	raw := []byte(password)
	if len(raw) > bcryptMaxBytes {
		raw = raw[:bcryptMaxBytes]
	}
	hash, err := bcrypt.GenerateFromPassword(raw, bcryptCost)
	if err != nil {
		return "", err
	}
	return strings.Replace(string(hash), "$2a$", "$2b$", 1), nil
}
