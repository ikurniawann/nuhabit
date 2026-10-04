package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/validate"
)

/* ── Telegram bot webhook ────────────────────────────────────────────── */

// TelegramChat is the chat object of a Telegram update.
type TelegramChat struct {
	ID        int64   `json:"id"`
	Type      string  `json:"type"`
	Title     *string `json:"title"`
	Username  *string `json:"username"`
	FirstName *string `json:"first_name"`
	LastName  *string `json:"last_name"`
}

// TelegramUpdate is the part of an update the webhook reads.
type TelegramUpdate struct {
	Message *struct {
		Text *string       `json:"text"`
		Chat *TelegramChat `json:"chat"`
	} `json:"message"`
	MyChatMember *struct {
		Chat          *TelegramChat `json:"chat"`
		NewChatMember *struct {
			Status *string `json:"status"`
		} `json:"new_chat_member"`
	} `json:"my_chat_member"`
}

// TelegramCommand is the bot command of a message text: the first word
// without its @bot suffix, lower-cased ("/start@bcd_bot hi" -> "/start").
func TelegramCommand(text *string) string {
	if text == nil {
		return ""
	}
	fields := strings.FieldsFunc(validate.JSTrim(*text), unicodeSpace)
	if len(fields) == 0 {
		return ""
	}
	cmd, _, _ := strings.Cut(fields[0], "@")
	return strings.ToLower(cmd)
}

// ChatTitle is chatTitle: the group title, else "first last", else nil.
func ChatTitle(c TelegramChat) *string {
	if c.Title != nil && *c.Title != "" {
		return c.Title
	}
	var parts []string
	for _, p := range []*string{c.FirstName, c.LastName} {
		if p != nil && *p != "" {
			parts = append(parts, *p)
		}
	}
	if len(parts) == 0 {
		return nil
	}
	name := strings.Join(parts, " ")
	return &name
}

// unicodeSpace is the JS \s class.
func unicodeSpace(r rune) bool { return validate.JSTrim(string(r)) == "" }

/* ── loyalty partners (lib/crm/partners.ts) ──────────────────────────── */

const (
	// PartnerSignatureHeader and PartnerTimestampHeader name the headers.
	PartnerSignatureHeader = "X-Signature"
	PartnerTimestampHeader = "X-Timestamp"
	// partnerTimestampTolerance is TIMESTAMP_TOLERANCE_SECONDS.
	partnerTimestampTolerance = 5 * 60
)

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// VerifyPartnerSignature is verifySignature: header "sha256=<hex>" must be
// the HMAC-SHA256 of the raw body with the partner's secret (constant
// time). A partner without a secret can send nothing.
func VerifyPartnerSignature(rawBody []byte, header, secret string) bool {
	if secret == "" || header == "" || !strings.HasPrefix(header, "sha256=") {
		return false
	}
	provided := strings.ToLower(validate.JSTrim(strings.TrimPrefix(header, "sha256=")))
	if !hex64.MatchString(provided) {
		return false
	}
	given, _ := hex.DecodeString(provided)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(rawBody)
	return hmac.Equal(given, mac.Sum(nil))
}

var unixSeconds = regexp.MustCompile(`^\d{9,11}$`)

// IsTimestampFresh is isTimestampFresh: header (Unix seconds) within five
// minutes of now.
func IsTimestampFresh(header string, now time.Time) bool {
	t := validate.JSTrim(header)
	if header == "" || !unixSeconds.MatchString(t) {
		return false
	}
	sec, _ := strconv.ParseFloat(t, 64)
	return math.Abs(float64(now.UnixMilli())/1000-sec) <= partnerTimestampTolerance
}

/* ── WhatsApp gateway inbound (lib/whatsapp/inbound.ts) ──────────────── */

// GatewayInbound is the normalized gateway message (NormalizedInbound).
type GatewayInbound struct {
	Channel           string
	ExternalID        string
	Phone             *string
	Direction         string // "in" | "out"
	Body              *string
	MediaType         *string
	ProviderMessageID *string
	PushName          *string
	SentAt            *time.Time
}

var mediaTypes = map[string]bool{"image": true, "video": true, "audio": true, "document": true, "sticker": true}

// NormalizeInbound is normalizeInbound: nil unless payload is a personal
// chat message with text or a known media type.
func NormalizeInbound(payload any) *GatewayInbound {
	p := Obj(payload)
	jid, _ := p["remoteJid"].(string)
	if !strings.HasSuffix(jid, "@s.whatsapp.net") {
		return nil
	}
	phone := jidToPhone(jid)
	if phone == "" {
		return nil
	}
	rawText := ""
	if s, ok := p["text"].(string); ok {
		rawText = validate.JSTrim(s)
	}
	var mediaType *string
	if s, ok := p["mediaType"].(string); ok && mediaTypes[s] {
		mediaType = &s
	}
	if rawText == "" && mediaType == nil {
		return nil
	}
	m := &GatewayInbound{Channel: "whatsapp", ExternalID: phone, Phone: &phone, Direction: "in", MediaType: mediaType}
	if Truthy(p["fromMe"]) {
		m.Direction = "out"
	}
	if ts := jsNumber(p["timestamp"]); finite(ts) && ts > 0 {
		at := time.UnixMilli(int64(ts * 1000)).UTC()
		m.SentAt = &at
	}
	if rawText != "" {
		body := utf16Prefix(rawText, 4000)
		m.Body = &body
	}
	if id, ok := p["messageId"].(string); ok && id != "" {
		m.ProviderMessageID = &id
	}
	if name, ok := p["pushName"].(string); ok {
		if t := validate.JSTrim(name); t != "" {
			m.PushName = &t
		}
	}
	return m
}

// jidToPhone is jidToPhone: the digits before "@" (and ":device"), 10-15
// of them, else "".
func jidToPhone(jid string) string {
	user, _, _ := strings.Cut(jid, "@")
	user, _, _ = strings.Cut(user, ":")
	var b strings.Builder
	for _, c := range user {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	if d := b.String(); len(d) >= 10 && len(d) <= 15 {
		return d
	}
	return ""
}

// utf16Prefix is s.slice(0, n) in UTF-16 units.
func utf16Prefix(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}
