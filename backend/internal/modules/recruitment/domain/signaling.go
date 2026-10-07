package domain

import (
	"regexp"
	"time"
)

// Live monitoring WebRTC signaling (webrtc-signaling.ts): HR posts an SDP
// offer, the candidate portal polls pending offers and posts answers, HR
// polls the answer. Vanilla ICE, no media server. Offers are stored in
// recruitment.live_signals, so any replica serves either side.

const (
	// SignalTTL is how long an offer and its answer live.
	SignalTTL = 2 * time.Minute
	// MaxOffersPerSession keeps the newest offers of a session.
	MaxOffersPerSession = 3
	// MaxSDPChars caps an SDP string (sdpSchema).
	MaxSDPChars = 100_000
)

var offerIDPattern = regexp.MustCompile(`(?i)^[a-z0-9-]{8,64}$`)

// IsOfferID reports whether an HR viewer's offer id is acceptable.
func IsOfferID(s string) bool { return offerIDPattern.MatchString(s) }

// IsLiveSessionType reports whether t is a live-monitored session type.
func IsLiveSessionType(t string) bool { return t == "psikotes" || t == "interview" }

// PendingOffer is an unanswered HR offer for the candidate.
type PendingOffer struct {
	OfferID string `json:"offer_id"`
	SDP     string `json:"sdp"`
}
