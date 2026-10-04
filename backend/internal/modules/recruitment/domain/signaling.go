package domain

import (
	"regexp"
	"sync"
	"time"
)

// Live monitoring WebRTC signaling (webrtc-signaling.ts): HR posts an SDP
// offer, the candidate portal polls pending offers and posts answers, HR
// polls the answer. Vanilla ICE, no media server. The store is in memory per
// process, so the HR and candidate signaling routes must be served by the
// same single instance (the TS version runs as one PM2 process for the same
// reason). Entries live two minutes.

const (
	signalTTL           = 2 * time.Minute
	maxOffersPerSession = 3
	// MaxSDPChars caps an SDP string (sdpSchema).
	MaxSDPChars = 100_000
)

var offerIDPattern = regexp.MustCompile(`(?i)^[a-z0-9-]{8,64}$`)

// IsOfferID reports whether an HR viewer's offer id is acceptable.
func IsOfferID(s string) bool { return offerIDPattern.MatchString(s) }

// IsLiveSessionType reports whether t is a live-monitored session type.
func IsLiveSessionType(t string) bool { return t == "psikotes" || t == "interview" }

type signal struct {
	offerID   string
	offerSDP  string
	answerSDP *string
	created   time.Time
}

// PendingOffer is an unanswered HR offer for the candidate.
type PendingOffer struct {
	OfferID string `json:"offer_id"`
	SDP     string `json:"sdp"`
}

// Signaling is the in-memory offer/answer store.
type Signaling struct {
	mu    sync.Mutex
	store map[string][]*signal
}

// NewSignaling builds an empty store.
func NewSignaling() *Signaling { return &Signaling{store: map[string][]*signal{}} }

func (s *Signaling) live(key string, now time.Time) []*signal {
	kept := s.store[key][:0:0]
	for _, e := range s.store[key] {
		if now.Sub(e.created) < signalTTL {
			kept = append(kept, e)
		}
	}
	if len(kept) == 0 {
		delete(s.store, key)
		return nil
	}
	s.store[key] = kept
	return kept
}

// PutOffer stores an HR offer; the oldest is dropped past three per session.
func (s *Signaling) PutOffer(sessionType, sessionID, offerID, sdp string, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := sessionType + ":" + sessionID
	entries := append(s.live(key, now), &signal{offerID: offerID, offerSDP: sdp, created: now})
	if len(entries) > maxOffersPerSession {
		entries = entries[len(entries)-maxOffersPerSession:]
	}
	s.store[key] = entries
}

// PendingOffers lists the offers the candidate has not answered.
func (s *Signaling) PendingOffers(sessionType, sessionID string, now time.Time) []PendingOffer {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []PendingOffer{}
	for _, e := range s.live(sessionType+":"+sessionID, now) {
		if e.answerSDP == nil {
			out = append(out, PendingOffer{OfferID: e.offerID, SDP: e.offerSDP})
		}
	}
	return out
}

// PutAnswer answers one offer; false when the offer is unknown or expired.
func (s *Signaling) PutAnswer(sessionType, sessionID, offerID, sdp string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.live(sessionType+":"+sessionID, now) {
		if e.offerID == offerID {
			e.answerSDP = &sdp
			return true
		}
	}
	return false
}

// Answer returns the candidate's answer to an offer, nil until answered.
func (s *Signaling) Answer(sessionType, sessionID, offerID string, now time.Time) *string {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.live(sessionType+":"+sessionID, now) {
		if e.offerID == offerID {
			return e.answerSDP
		}
	}
	return nil
}
