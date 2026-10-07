package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
)

// Ports lib/crm/conversation-insights.ts and the parts of the shared
// lib/conversation-analytics the inbox uses (transcript, fingerprint,
// prompt, model answer parsing, keyword normalization).

// AnalyzedMessageTypes are the wa_messages types an analysis reads: only
// two-way chat, never our own system/notification/broadcast texts.
var AnalyzedMessageTypes = []string{"chat"}

// Limits of the analysis.
const (
	MaxTranscriptMessages = 300
	DefaultPendingLimit   = 25
	MaxPendingLimit       = 100
	MaxTranscriptChars    = 6000
)

// ClampPendingLimit mirrors clampPendingLimit: numbers (or numeric strings)
// above zero, floored and capped; anything else falls back to the default.
func ClampPendingLimit(raw any) int {
	var v float64
	switch x := raw.(type) {
	case float64:
		v = x
	case int:
		v = float64(x)
	case string:
		f, ok := jsNumber(x)
		if !ok {
			return DefaultPendingLimit
		}
		v = f
	default:
		return DefaultPendingLimit
	}
	if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return DefaultPendingLimit
	}
	return int(math.Min(math.Floor(v), MaxPendingLimit))
}

// jsNumber is Number(s) for a string: blank is 0, NaN is not ok.
func jsNumber(s string) (float64, bool) {
	s = JSTrim(s)
	if s == "" {
		return 0, true
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// TranscriptMessage is one message of a transcript, from the business's
// point of view.
type TranscriptMessage struct {
	Direction string // "in" | "out"
	Body      string
}

// NormalizeDirection maps a wa_messages.direction (or the wagateway
// inbound/outbound spelling) to in/out; anything unknown is "out" so an
// agent message is never read as the customer's voice.
func NormalizeDirection(raw any) string {
	s, _ := raw.(string)
	switch strings.ToLower(JSTrim(s)) {
	case "in", "inbound", "incoming", "received":
		return "in"
	}
	return "out"
}

// MessageRow is the slice of a wa_messages row the analysis reads.
type MessageRow struct {
	Direction any
	Body      any
}

// ToTranscript mirrors toTranscriptMessages: rows without text are dropped
// and bodies are trimmed.
func ToTranscript(rows []MessageRow) []TranscriptMessage {
	out := []TranscriptMessage{}
	for _, row := range rows {
		body, _ := row.Body.(string)
		body = JSTrim(body)
		if body == "" {
			continue
		}
		out = append(out, TranscriptMessage{Direction: NormalizeDirection(row.Direction), Body: body})
	}
	return out
}

// Fingerprint mirrors fingerprintTranscript: FNV-1a over the UTF-16 units
// of "dir:body" lines, prefixed with the message count.
func Fingerprint(messages []TranscriptMessage) string {
	lines := make([]string, len(messages))
	for i, m := range messages {
		lines[i] = m.Direction + ":" + m.Body
	}
	hash := uint32(0x811c9dc5)
	for _, u := range utf16.Encode([]rune(strings.Join(lines, "\n"))) {
		hash ^= uint32(u)
		hash *= 0x01000193
	}
	return strconv.Itoa(len(messages)) + "-" + strconv.FormatUint(uint64(hash), 16)
}

// NeedsAnalysis is the cache decision: analyze when nothing is stored or
// the stored fingerprint differs.
func NeedsAnalysis(storedFingerprint *string, fingerprint string) bool {
	return storedFingerprint == nil || *storedFingerprint == "" || *storedFingerprint != fingerprint
}

const truncationMarker = "\n… (bagian tengah percakapan dipotong) …\n"

// TranscriptText mirrors transcriptToText: labelled lines; a transcript
// longer than maxChars keeps its start and end around a marker.
func TranscriptText(messages []TranscriptMessage, maxChars int) string {
	var lines []string
	for _, m := range messages {
		body := JSTrim(m.Body)
		if body == "" {
			continue
		}
		label := "Agen"
		if m.Direction == "in" {
			label = "Pelanggan"
		}
		lines = append(lines, label+": "+body)
	}
	full := strings.Join(lines, "\n")
	n := UTF16Len(full)
	if n <= maxChars {
		return full
	}
	half := (maxChars - UTF16Len(truncationMarker)) / 2
	return UTF16Slice(full, 0, half) + truncationMarker + UTF16Slice(full, n-half, n)
}

var systemPrompt = strings.Join([]string{
	"Kamu menganalisa percakapan layanan pelanggan berbahasa Indonesia.",
	"Jawab HANYA dengan satu objek JSON tanpa penjelasan tambahan dan tanpa pagar kode.",
	`Bentuk JSON: {"summary": string, "topic": string, "sentiment": "positif"|"netral"|"negatif", "is_complaint": boolean, "keywords": string[]}.`,
	"summary: 1-2 kalimat ringkas berisi inti permintaan pelanggan dan hasil akhirnya.",
	`topic: label singkat maksimal 4 kata, huruf kecil, mis. "keluhan pengiriman" atau "tanya harga".`,
	"sentiment: perasaan pelanggan, bukan perasaan agen.",
	"is_complaint: true hanya bila pelanggan menyatakan ketidakpuasan atau masalah nyata.",
	"keywords: 3-8 kata/frasa kunci spesifik dari isi percakapan (produk, masalah, lokasi, layanan).",
	"Jangan memasukkan nama orang, nomor telepon, atau alamat ke keywords maupun topic.",
	`Bila percakapan terlalu pendek atau tidak bermakna, tetap jawab JSON dengan topic "tidak jelas".`,
}, " ")

// ChatMessage is one chat-completions message.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// AnalysisMessages mirrors buildAnalysisMessages.
func AnalysisMessages(transcript []TranscriptMessage) []ChatMessage {
	return []ChatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: "Percakapan:\n" + TranscriptText(transcript, MaxTranscriptChars)},
	}
}

// Insight is a parsed analysis (ConversationInsight), in the TS key order.
type Insight struct {
	Summary     string   `json:"summary"`
	Topic       string   `json:"topic"`
	Sentiment   string   `json:"sentiment"`
	IsComplaint bool     `json:"is_complaint"`
	Keywords    []string `json:"keywords"`
}

var (
	fenceOpen  = regexp.MustCompile("^```[a-zA-Z]*")
	fenceClose = regexp.MustCompile("```$")
)

func stripCodeFence(v string) string {
	t := JSTrim(v)
	if !strings.HasPrefix(t, "```") {
		return t
	}
	t = strings.TrimLeftFunc(fenceOpen.ReplaceAllString(t, ""), isJSSpace)
	t = fenceClose.ReplaceAllString(strings.TrimRightFunc(t, isJSSpace), "")
	return JSTrim(t)
}

func clampText(v any, max int) string {
	s, _ := v.(string)
	s = JSTrim(collapseSpace(s))
	if UTF16Len(s) > max {
		return JSTrim(UTF16Slice(s, 0, max))
	}
	return s
}

// Sentiment maps a model or stored sentiment to positif/netral/negatif.
func Sentiment(v any) string {
	s, _ := v.(string)
	switch strings.ToLower(JSTrim(s)) {
	case "positif", "positive":
		return "positif"
	case "negatif", "negative":
		return "negatif"
	}
	return "netral"
}

// ParseInsight mirrors parseInsight: nil when the answer is not a JSON
// object; every field is validated and normalized.
func ParseInsight(raw string) *Insight {
	if JSTrim(raw) == "" {
		return nil
	}
	var parsed any
	if json.Unmarshal([]byte(stripCodeFence(raw)), &parsed) != nil {
		return nil
	}
	src, ok := parsed.(map[string]any)
	if !ok {
		return nil
	}
	topic := strings.ToLower(clampText(src["topic"], 60))
	if topic == "" {
		topic = "tidak jelas"
	}
	complaint, _ := src["is_complaint"].(bool)
	return &Insight{
		Summary:     clampText(src["summary"], 500),
		Topic:       topic,
		Sentiment:   Sentiment(src["sentiment"]),
		IsComplaint: complaint,
		Keywords:    NormalizeKeywordList(src["keywords"]),
	}
}

var stopwordsID = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`yang dan di ke dari untuk dengan pada adalah itu
		ini atau juga sudah belum tidak bukan ada akan
		saya aku kami kita anda kamu dia mereka
		bisa boleh mau ingin harus saja aja kok sih dong
		ya iya oke ok gak ngga nggak tak nya
		pak bu bapak ibu mas mbak kak bang
		terima kasih tolong mohon selamat halo hai assalamualaikum
		pagi siang sore malam
		apa kapan dimana mana kenapa bagaimana gimana berapa
		lagi masih sangat sekali banget agak cuma hanya`) {
		stopwordsID[w] = true
	}
}

// NormalizeKeyword mirrors normalizeKeyword: lower case, punctuation to
// spaces, 3..40 UTF-16 units, at least three letters in a row, and not
// made only of stopwords; "" when unusable.
func NormalizeKeyword(raw any) string {
	s, ok := raw.(string)
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || isJSSpace(r) || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	cleaned := JSTrim(collapseSpace(b.String()))
	if n := UTF16Len(cleaned); n < 3 || n > 40 {
		return ""
	}
	run := 0
	hasWord := false
	for _, r := range cleaned {
		if unicode.IsLetter(r) {
			run++
			if run >= 3 {
				hasWord = true
				break
			}
		} else {
			run = 0
		}
	}
	if !hasWord {
		return ""
	}
	for _, w := range strings.Split(cleaned, " ") {
		if !stopwordsID[w] {
			return cleaned
		}
	}
	return ""
}

// NormalizeKeywordList mirrors normalizeKeywordList(raw, 8): cleaned,
// de-duplicated, at most eight; [] when raw is not an array.
func NormalizeKeywordList(raw any) []string {
	items, _ := raw.([]any)
	out := []string{}
	for _, item := range items {
		if k := NormalizeKeyword(item); k != "" && !slices.Contains(out, k) {
			out = append(out, k)
		}
		if len(out) >= 8 {
			break
		}
	}
	return out
}

// Analyze statuses.
const (
	StatusCache    = "cache"
	StatusAnalyzed = "analyzed"
	StatusEmpty    = "empty"
	StatusFailed   = "failed"
)

// BatchSummary is AnalyzeBatchSummary.
type BatchSummary struct {
	Requested int `json:"requested"`
	Analyzed  int `json:"analyzed"`
	Cached    int `json:"cached"`
	Empty     int `json:"empty"`
	Failed    int `json:"failed"`
}

// SummarizeBatch counts the statuses of a batch.
func SummarizeBatch(statuses []string) BatchSummary {
	s := BatchSummary{Requested: len(statuses)}
	for _, st := range statuses {
		switch st {
		case StatusAnalyzed:
			s.Analyzed++
		case StatusCache:
			s.Cached++
		case StatusEmpty:
			s.Empty++
		default:
			s.Failed++
		}
	}
	return s
}
