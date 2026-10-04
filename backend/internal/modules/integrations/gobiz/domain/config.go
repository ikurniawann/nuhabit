// Package domain holds the pure GoBiz/GoFood integration rules: webhook
// authentication
// (lib/gobiz/signature.ts, lib/security/compare.ts), webhook parsing and the
// order status machine (lib/gobiz/mapping.ts), and the catalog payload with
// GoFood channel prices (lib/gobiz/catalog.ts, image.ts,
// lib/pos/channel-pricing.ts).
package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
	"unicode"
)

// WebhookURL is gobizWebhookUrl: the public URL registered at GoBiz; the
// random token in the path authenticates the caller.
func WebhookURL(appURL, token string) string {
	return strings.TrimSuffix(appURL, "/") + "/api/integrations/gobiz/webhook/" + token
}

// SafeEqual is safeEqual (lib/security/compare.ts): both sides hashed with
// SHA-256 and compared in constant time; an empty side never matches.
func SafeEqual(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	da, db := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(da[:], db[:]) == 1
}

// Signature statuses (GobizSignatureStatus).
const (
	SignatureValid        = "valid"
	SignatureInvalid      = "invalid"
	SignatureMissing      = "missing"
	SignatureUnconfigured = "unconfigured"
)

// ComputeSignature is computeGobizSignature: HMAC-SHA256 hex of the raw body.
func ComputeSignature(rawBody, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(rawBody))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifySignature is verifyGobizSignature for the X-Go-Signature header.
func VerifySignature(rawBody, header, secret string) string {
	if secret == "" {
		return SignatureUnconfigured
	}
	given := strings.ToLower(JSTrim(header))
	if given == "" {
		return SignatureMissing
	}
	expected := ComputeSignature(rawBody, secret)
	if len(given) != len(expected) || subtle.ConstantTimeCompare([]byte(given), []byte(expected)) != 1 {
		return SignatureInvalid
	}
	return SignatureValid
}

// JSTrim is String.prototype.trim.
func JSTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
}
