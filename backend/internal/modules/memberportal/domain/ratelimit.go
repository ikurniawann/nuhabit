package domain

import "time"

// RateRule is a sliding-window limit.
type RateRule struct {
	Limit  int
	Window time.Duration
}

// Per-IP brakes on top of the per-number and per-code limits
// (MEMBER_IP_LIMITS in otp-store.ts). Loose because a cafe Wi-Fi is shared.
var (
	IPRuleOTP    = RateRule{Limit: 30, Window: 10 * time.Minute}
	IPRuleVerify = RateRule{Limit: 60, Window: 10 * time.Minute}
)

// TooManyFromIP is the per-IP rejection message.
const TooManyFromIP = "Terlalu banyak permintaan dari jaringan ini. Coba lagi beberapa menit lagi"
