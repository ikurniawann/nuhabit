package domain

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"
)

// ClientIP is clientIpFromHeaders: cf-connecting-ip, the left-most
// x-forwarded-for, x-real-ip, else "unknown".
func ClientIP(h http.Header) string {
	if ip := strings.TrimSpace(h.Get("cf-connecting-ip")); ip != "" {
		return ip
	}
	if first := strings.TrimSpace(strings.Split(h.Get("x-forwarded-for"), ",")[0]); first != "" {
		return first
	}
	if ip := strings.TrimSpace(h.Get("x-real-ip")); ip != "" {
		return ip
	}
	return "unknown"
}

// SafeEqual is safeEqual (lib/security/compare): both sides hashed with
// SHA-256 and compared in constant time; an empty side never matches.
func SafeEqual(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	da, db := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(da[:], db[:]) == 1
}

// PhoneDigits keeps the digits of a phone number.
func PhoneDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// MarketplaceImportable are the Shopee statuses meaning "paid, to process".
var MarketplaceImportable = map[string]bool{"READY_TO_SHIP": true, "PROCESSED": true, "SHIPPED": true, "COMPLETED": true}

// MarketplaceStatus maps a Shopee order status to the shop order status.
var MarketplaceStatus = map[string]string{
	"READY_TO_SHIP": "paid",
	"PROCESSED":     "packing",
	"SHIPPED":       "shipped",
	"COMPLETED":     "completed",
}
