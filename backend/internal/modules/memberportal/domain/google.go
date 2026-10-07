package domain

import (
	"crypto"
	"crypto/hmac"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Google sign-in: the ID token Google Identity Services hands the browser
// is an RS256 JWT. It is verified against Google's JWKS (fetched by the
// adapter) with the audience of our OAuth client. A verified token whose
// email belongs to no member becomes a short-lived signed ticket; the
// registration then carries the ticket plus the phone and its OTP.

// GoogleClaims are the claims sign-in reads from a verified ID token.
type GoogleClaims struct {
	Sub           string
	Email         string
	EmailVerified bool
	Name          string
}

// ErrGoogleToken is any ID token rejection; the message says why.
var ErrGoogleToken = errors.New("token Google tidak valid")

var googleIssuers = map[string]bool{"accounts.google.com": true, "https://accounts.google.com": true}

// GoogleKeyLookup returns the RSA key for a JWKS key id, nil when unknown.
type GoogleKeyLookup func(kid string) *rsa.PublicKey

func b64url(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

// ParseGoogleIDToken verifies signature, issuer, audience and expiry.
func ParseGoogleIDToken(token string, keyOf GoogleKeyLookup, audience string, now time.Time) (GoogleClaims, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return GoogleClaims{}, ErrGoogleToken
	}
	headerRaw, err := b64url(parts[0])
	if err != nil {
		return GoogleClaims{}, ErrGoogleToken
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if json.Unmarshal(headerRaw, &header) != nil || header.Alg != "RS256" {
		return GoogleClaims{}, ErrGoogleToken
	}
	key := keyOf(header.Kid)
	if key == nil {
		return GoogleClaims{}, ErrGoogleToken
	}
	sig, err := b64url(parts[2])
	if err != nil {
		return GoogleClaims{}, ErrGoogleToken
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig) != nil {
		return GoogleClaims{}, ErrGoogleToken
	}
	claimsRaw, err := b64url(parts[1])
	if err != nil {
		return GoogleClaims{}, ErrGoogleToken
	}
	var c struct {
		Iss           string `json:"iss"`
		Aud           string `json:"aud"`
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Exp           int64  `json:"exp"`
	}
	if json.Unmarshal(claimsRaw, &c) != nil {
		return GoogleClaims{}, ErrGoogleToken
	}
	switch {
	case !googleIssuers[c.Iss], audience == "" || c.Aud != audience, c.Sub == "":
		return GoogleClaims{}, ErrGoogleToken
	case c.Exp == 0 || !now.Before(time.Unix(c.Exp, 0)):
		return GoogleClaims{}, errors.New("token Google kedaluwarsa, coba masuk lagi")
	}
	return GoogleClaims{
		Sub: c.Sub, Email: strings.ToLower(strings.TrimSpace(c.Email)), EmailVerified: c.EmailVerified,
		Name: strings.TrimSpace(c.Name),
	}, nil
}

// GoogleTicketTTL is how long a verified Google identity may wait for a
// phone number before the member must sign in again.
const GoogleTicketTTL = 15 * time.Minute

// GoogleTicket is a verified Google identity awaiting a phone number.
type GoogleTicket struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Exp   int64  `json:"exp"`
}

func ticketMAC(secret, payload []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return mac.Sum(nil)
}

// SignGoogleTicket encodes the ticket as payload.signature (base64url).
func SignGoogleTicket(secret []byte, t GoogleTicket, now time.Time) string {
	t.Exp = now.Add(GoogleTicketTTL).Unix()
	payload, _ := json.Marshal(t)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(ticketMAC(secret, payload))
}

// ErrGoogleTicket is a missing, forged or expired ticket.
var ErrGoogleTicket = errors.New("Sesi Google kedaluwarsa, masuk dengan Google lagi")

// ParseGoogleTicket verifies the signature and expiry.
func ParseGoogleTicket(secret []byte, raw string, now time.Time) (GoogleTicket, error) {
	payloadB64, sigB64, ok := strings.Cut(strings.TrimSpace(raw), ".")
	if !ok {
		return GoogleTicket{}, ErrGoogleTicket
	}
	payload, err := b64url(payloadB64)
	if err != nil {
		return GoogleTicket{}, ErrGoogleTicket
	}
	sig, err := b64url(sigB64)
	if err != nil || !hmac.Equal(sig, ticketMAC(secret, payload)) {
		return GoogleTicket{}, ErrGoogleTicket
	}
	var t GoogleTicket
	if json.Unmarshal(payload, &t) != nil || t.Sub == "" || t.Email == "" || !now.Before(time.Unix(t.Exp, 0)) {
		return GoogleTicket{}, ErrGoogleTicket
	}
	return t, nil
}
