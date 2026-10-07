package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Ports lib/instagram/webhook.ts, messagePreview from lib/whatsapp/inbound.ts
// and the two owner notification texts of lib/wa/notifications-messages.ts.

// Inbound is NormalizedInbound: one message to store on a conversation.
type Inbound struct {
	Channel           string // "whatsapp" | "instagram"
	ExternalID        string
	Phone             *string
	Direction         string // "in" | "out"
	Body              *string
	MediaType         *string
	ProviderMessageID *string
	PushName          *string
	SentAt            *time.Time
}

// MessagePreview is the conversation list preview: text cut to 80 UTF-16
// units, or "[media]".
func MessagePreview(body, mediaType *string) string {
	if body != nil && *body != "" {
		if UTF16Len(*body) > 80 {
			return UTF16Slice(*body, 0, 77) + "..."
		}
		return *body
	}
	if mediaType != nil && *mediaType != "" {
		return "[" + *mediaType + "]"
	}
	return ""
}

// VerifySignature checks X-Hub-Signature-256 ("sha256=" + hex HMAC-SHA256
// of the raw body with the app secret) in constant time.
func VerifySignature(rawBody []byte, header, appSecret string) bool {
	if header == "" || appSecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write(rawBody)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(header), []byte(expected))
}

// SubscribeChallenge mirrors resolveSubscribeChallenge: the hub.challenge
// to echo when the mode and verify token match, ok=false otherwise.
func SubscribeChallenge(params url.Values, verifyToken string) (string, bool) {
	if verifyToken == "" || params.Get("hub.mode") != "subscribe" ||
		subtle.ConstantTimeCompare([]byte(params.Get("hub.verify_token")), []byte(verifyToken)) != 1 {
		return "", false
	}
	if !params.Has("hub.challenge") {
		return "", false
	}
	return params.Get("hub.challenge"), true
}

var igMediaTypes = map[string]bool{"image": true, "video": true, "audio": true, "file": true, "share": true, "story_mention": true}

func str(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

func obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func list(v any) []any {
	l, _ := v.([]any)
	return l
}

// NormalizeInstagramWebhook mirrors normalizeInstagramWebhook: one Inbound
// per message event; deleted messages and events without text or
// attachment are skipped. Echoes (our own replies) are outbound and the
// counterpart is the recipient.
func NormalizeInstagramWebhook(payload any) []Inbound {
	p := obj(payload)
	if object, _ := str(p["object"]); object != "instagram" {
		return nil
	}
	var out []Inbound
	for _, entry := range list(p["entry"]) {
		for _, ev := range list(obj(entry)["messaging"]) {
			event := obj(ev)
			msg := obj(event["message"])
			if msg == nil || msg["is_deleted"] == true {
				continue
			}
			echo := msg["is_echo"] == true
			party := obj(event["sender"])
			direction := "in"
			if echo {
				party, direction = obj(event["recipient"]), "out"
			}
			id, _ := str(party["id"])
			id = JSTrim(id)
			if id == "" {
				continue
			}
			var body, media *string
			if text, ok := str(msg["text"]); ok {
				body = &text
			}
			if atts := list(msg["attachments"]); len(atts) > 0 {
				if t, _ := str(obj(atts[0])["type"]); t != "" {
					if !igMediaTypes[t] {
						t = "unknown"
					}
					media = &t
				}
			}
			if (body == nil || *body == "") && media == nil {
				continue
			}
			in := Inbound{Channel: "instagram", ExternalID: id, Direction: direction, Body: body, MediaType: media}
			if mid, ok := str(msg["mid"]); ok {
				in.ProviderMessageID = &mid
			}
			if ts, ok := event["timestamp"].(float64); ok && ts != 0 {
				at := time.UnixMilli(int64(ts))
				in.SentAt = &at
			}
			out = append(out, in)
		}
	}
	return out
}

// ReplyWindow is Meta's reply window since the last inbound message.
const ReplyWindow = 24 * time.Hour

// WithinReplyWindow mirrors isWithinReplyWindow.
func WithinReplyWindow(lastInbound *time.Time, now time.Time) bool {
	return lastInbound != nil && lastInbound.Add(ReplyWindow).Sub(now) > 0
}

// KomplainMessage mirrors buildKomplainMessage.
func KomplainMessage(displayName *string, phone string, category, priority *string) string {
	from := phone
	if displayName != nil && *displayName != "" {
		from = *displayName
	}
	lines := []string{"🚨 *Komplain Pelanggan Masuk*", "", "Dari: " + from}
	if category != nil && *category != "" {
		lines = append(lines, "Kategori: "+*category)
	}
	if priority != nil && *priority != "" {
		lines = append(lines, "Prioritas: "+*priority)
	}
	return strings.Join(append(lines, "", "Buka CRM → Inbox WA untuk menangani."), "\n")
}

// ReviewRendahMessage mirrors buildReviewRendahMessage.
func ReviewRendahMessage(reviewerName string, starRating int, comment *string) string {
	name := reviewerName
	if name == "" {
		name = "Anonim"
	}
	stars := strings.Repeat("⭐", max(1, min(5, starRating)))
	lines := []string{"🚨 *Review Google Bintang Rendah*", "", stars + " (" + strconv.Itoa(starRating) + "/5) dari " + name}
	if comment != nil && *comment != "" {
		lines = append(lines, `"`+UTF16Slice(*comment, 0, 300)+`"`)
	}
	return strings.Join(append(lines, "", "Balas segera di CRM → Google Review — respons cepat menyelamatkan reputasi."), "\n")
}
