package auth

import (
	"crypto/rand"
	"math/big"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost is bcryptjs.hash(password, 10) in lib/auth/password.ts.
const bcryptCost = 10

// bcrypt reads at most 72 bytes of a password; bcryptjs drops the rest
// silently, x/crypto refuses to hash a longer one.
const bcryptMaxBytes = 72

// VerifyPassword is verifyPassword: an empty hash never matches. bcryptjs
// accepts $2a$, $2b$ and $2y$ hashes and so does x/crypto.
func VerifyPassword(password, hash string) bool {
	if hash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// HashPassword is hashPassword. The prefix is rewritten to $2b$, the version
// bcryptjs 3 writes, so Go-written hashes look like TS-written ones (the two
// versions hash a password under 255 bytes identically).
func HashPassword(password string) (string, error) {
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

// passwordLetters and passwordDigits leave out the glyphs that read alike
// when a password is dictated or copied by hand (0/O, 1/l/I).
const (
	passwordLetters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
	passwordDigits  = "23456789"
)

// GeneratePassword returns a random password of n characters (n >= 2) with
// at least one letter and one digit, so it passes the member password rule.
func GeneratePassword(n int) (string, error) {
	out := make([]byte, n)
	for i := range out {
		alphabet := passwordLetters + passwordDigits
		switch i {
		case 0:
			alphabet = passwordLetters
		case 1:
			alphabet = passwordDigits
		}
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		out[i] = alphabet[idx.Int64()]
	}
	// Shuffle so the forced letter and digit do not sit at fixed positions.
	for i := len(out) - 1; i > 0; i-- {
		j, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return "", err
		}
		out[i], out[j.Int64()] = out[j.Int64()], out[i]
	}
	return string(out), nil
}
