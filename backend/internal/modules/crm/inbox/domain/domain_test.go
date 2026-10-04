package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

func TestNormalizeDirection(t *testing.T) {
	cases := map[any]string{
		"in": "in", "out": "out", "inbound": "in", "incoming": "in", "received": "in", "outbound": "out",
		" IN ": "in", "Inbound": "in", "entahlah": "out", nil: "out", 7: "out",
	}
	for in, want := range cases {
		if got := NormalizeDirection(in); got != want {
			t.Errorf("NormalizeDirection(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestToTranscript(t *testing.T) {
	got := ToTranscript([]MessageRow{
		{Direction: "in", Body: "Pesanan saya belum datang"},
		{Direction: "out", Body: "Mohon maaf, kami cek dulu ya"},
	})
	want := []TranscriptMessage{{"in", "Pesanan saya belum datang"}, {"out", "Mohon maaf, kami cek dulu ya"}}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v", got)
	}
	got = ToTranscript([]MessageRow{{"in", nil}, {"in", "   "}, {"in", "  halo  "}, {"out", 12345}})
	if len(got) != 1 || got[0] != (TranscriptMessage{"in", "halo"}) {
		t.Fatalf("drops empty bodies: %v", got)
	}
	if got := ToTranscript(nil); len(got) != 0 {
		t.Fatalf("empty: %v", got)
	}
}

func TestNeedsAnalysisAndFingerprint(t *testing.T) {
	fp := "3-abc123"
	if !NeedsAnalysis(nil, fp) || NeedsAnalysis(&fp, fp) || !NeedsAnalysis(ptr("2-zzz999"), fp) || !NeedsAnalysis(ptr(""), fp) {
		t.Fatal("cache decision")
	}
	first := ToTranscript([]MessageRow{{"in", "stok ada?"}})
	stored := Fingerprint(first)
	later := ToTranscript([]MessageRow{{"in", "stok ada?"}, {"out", "ada kak"}})
	if NeedsAnalysis(&stored, Fingerprint(first)) || !NeedsAnalysis(&stored, Fingerprint(later)) {
		t.Fatal("new message must re-analyze")
	}
	a := []TranscriptMessage{{"in", "halo"}}
	if Fingerprint(a) != Fingerprint([]TranscriptMessage{{"in", "halo"}}) ||
		Fingerprint(a) == Fingerprint([]TranscriptMessage{{"in", "halox"}}) ||
		Fingerprint(a) == Fingerprint([]TranscriptMessage{{"out", "halo"}}) {
		t.Fatal("fingerprint stability")
	}
	// FNV-1a 32 of "in:halo" computed the JS way (Math.imul, >>> 0).
	if got := Fingerprint(a); got != "1-908cd7ca" {
		t.Fatalf("fingerprint = %s", got)
	}
}

func TestSummarizeBatch(t *testing.T) {
	got := SummarizeBatch([]string{StatusAnalyzed, StatusCache, StatusCache, StatusEmpty, StatusFailed})
	if got != (BatchSummary{Requested: 5, Analyzed: 1, Cached: 2, Empty: 1, Failed: 1}) {
		t.Fatalf("got %+v", got)
	}
	if SummarizeBatch(nil) != (BatchSummary{}) {
		t.Fatal("empty batch")
	}
}

func TestClampPendingLimit(t *testing.T) {
	cases := []struct {
		in   any
		want int
	}{
		{10.0, 10}, {"15", 15}, {nil, 25}, {0.0, 25}, {-5.0, 25}, {"banyak", 25},
		{math.NaN(), 25}, {math.Inf(1), 25}, {5000.0, 100}, {7.9, 7},
	}
	for _, c := range cases {
		if got := ClampPendingLimit(c.in); got != c.want {
			t.Errorf("ClampPendingLimit(%v) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestNormalizeKeyword(t *testing.T) {
	cases := map[any]string{
		"  Pengiriman,  Lambat!! ": "pengiriman lambat", "yang": "", "ya": "", "123": "", "10rb": "",
		"terima kasih": "", "tidak bisa login": "tidak bisa login", 42: "", nil: "",
	}
	for in, want := range cases {
		if got := NormalizeKeyword(in); got != want {
			t.Errorf("NormalizeKeyword(%v) = %q, want %q", in, got, want)
		}
	}
	got := NormalizeKeywordList([]any{"Kopi", "kopi", "gula", "susu", "es", "sirup", "roti", "keju", "teh", "kue"})
	if slices.Contains(got, "Kopi") || len(got) > 8 || len(slices.Compact(slices.Clone(got))) != len(got) {
		t.Fatalf("list: %v", got)
	}
	if got := NormalizeKeywordList("kopi"); len(got) != 0 {
		t.Fatalf("non-array: %v", got)
	}
}

func TestTranscriptText(t *testing.T) {
	msgs := []TranscriptMessage{{"in", "Pesanan saya belum datang"}, {"out", "Mohon maaf, kami cek dulu"}, {"in", "  "}}
	if got := TranscriptText(msgs, MaxTranscriptChars); got != "Pelanggan: Pesanan saya belum datang\nAgen: Mohon maaf, kami cek dulu" {
		t.Fatalf("got %q", got)
	}
	var long []TranscriptMessage
	for i := range 200 {
		dir := "out"
		if i%2 == 0 {
			dir = "in"
		}
		long = append(long, TranscriptMessage{dir, "pesan nomor " + strconv.Itoa(i) + " " + strings.Repeat("x", 50)})
	}
	got := TranscriptText(long, 1000)
	if UTF16Len(got) > 1000 || !strings.Contains(got, "dipotong") || !strings.Contains(got, "pesan nomor 0") || !strings.Contains(got, "pesan nomor 199") {
		t.Fatalf("truncation: %d %q", UTF16Len(got), got[:80])
	}
	m := AnalysisMessages([]TranscriptMessage{{"in", "halo"}})
	if len(m) != 2 || m[0].Role != "system" || !strings.Contains(m[0].Content, "JSON") || !strings.Contains(m[1].Content, "Pelanggan: halo") {
		t.Fatalf("messages: %v", m)
	}
}

func TestParseInsight(t *testing.T) {
	got := ParseInsight(`{"summary":"Pelanggan menanyakan status pesanan.","topic":"Status Pesanan","sentiment":"negatif","is_complaint":true,"keywords":["pesanan belum datang","pengiriman"]}`)
	if got == nil || got.Summary != "Pelanggan menanyakan status pesanan." || got.Topic != "status pesanan" || got.Sentiment != "negatif" ||
		!got.IsComplaint || !slices.Equal(got.Keywords, []string{"pesanan belum datang", "pengiriman"}) {
		t.Fatalf("got %+v", got)
	}
	if got := ParseInsight("```json\n{\"summary\":\"Ringkas.\",\"topic\":\"tanya harga\"}\n```"); got == nil || got.Topic != "tanya harga" || got.Sentiment != "netral" {
		t.Fatalf("code fence: %+v", got)
	}
	if got := ParseInsight(`{"summary":"a","topic":"b","sentiment":"kesal","is_complaint":"ya"}`); got.Sentiment != "netral" || got.IsComplaint {
		t.Fatalf("foreign values: %+v", got)
	}
	if got := ParseInsight(`{"summary":"a"}`); got.Topic != "tidak jelas" {
		t.Fatalf("empty topic: %+v", got)
	}
	for _, bad := range []string{"maaf saya tidak bisa", "[1,2]", ""} {
		if ParseInsight(bad) != nil {
			t.Errorf("ParseInsight(%q) should be nil", bad)
		}
	}
}

func TestParseStarRating(t *testing.T) {
	cases := map[any]int{"ONE": 1, "FIVE": 5, "three": 3, 4.0: 4, "2": 2, "STAR_RATING_UNSPECIFIED": 0, 0.0: 0, 9.0: 0, nil: 0}
	for in, want := range cases {
		if got := ParseStarRating(in); got != want {
			t.Errorf("ParseStarRating(%v) = %d, want %d", in, got, want)
		}
	}
}

func TestNormalizeReview(t *testing.T) {
	base := func() ReviewResource {
		var r ReviewResource
		r.Name = ptr("accounts/1/locations/2/reviews/abc")
		r.Reviewer = &struct {
			DisplayName     *string `json:"displayName"`
			ProfilePhotoURL *string `json:"profilePhotoUrl"`
			IsAnonymous     bool    `json:"isAnonymous"`
		}{DisplayName: ptr("Budi"), ProfilePhotoURL: ptr("https://x/y.jpg")}
		r.StarRating = "FOUR"
		r.Comment = ptr("  Tempatnya seru  ")
		r.CreateTime = ptr("2026-07-19T10:00:00Z")
		return r
	}
	got := NormalizeReview(base())
	if got == nil || got.ReviewName != "accounts/1/locations/2/reviews/abc" || got.ReviewerName != "Budi" || got.StarRating != 4 ||
		*got.Comment != "Tempatnya seru" || !got.CreatedAt.Equal(time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)) ||
		got.ReplyComment != nil || got.ReviewID != "abc" || *got.LocationID != "2" {
		t.Fatalf("got %+v", got)
	}
	anon := base()
	anon.Reviewer.IsAnonymous, anon.Reviewer.DisplayName = true, ptr("Nama Asli")
	if NormalizeReview(anon).ReviewerName != "Pengguna Google" {
		t.Fatal("anonymous name")
	}
	blank := base()
	blank.Comment = ptr("   ")
	if r := NormalizeReview(blank); r == nil || r.Comment != nil {
		t.Fatal("rating-only review")
	}
	replied := base()
	replied.ReviewReply = &struct {
		Comment    *string `json:"comment"`
		UpdateTime *string `json:"updateTime"`
	}{ptr("Terima kasih!"), ptr("2026-07-19T12:00:00Z")}
	if r := NormalizeReview(replied); *r.ReplyComment != "Terima kasih!" || !r.ReplyUpdatedAt.Equal(time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)) {
		t.Fatal("existing reply")
	}
	noName, badRating, badTime := base(), base(), base()
	noName.Name = nil
	badRating.StarRating = "STAR_RATING_UNSPECIFIED"
	badTime.CreateTime = ptr("bukan-tanggal")
	for _, r := range []ReviewResource{noName, badRating, badTime} {
		if NormalizeReview(r) != nil {
			t.Fatal("invalid review must be nil")
		}
	}
	bare := ReviewResource{ReviewID: ptr("rev-tanpa-lokasi"), StarRating: "FOUR", CreateTime: ptr("2026-07-19T10:00:00Z")}
	if r := NormalizeReview(bare); r.LocationID != nil || r.ReviewID != "rev-tanpa-lokasi" {
		t.Fatal("bare id")
	}
}

func TestReviewIDs(t *testing.T) {
	if ExtractReviewID("accounts/111/locations/222/reviews/ABC-xyz") != "ABC-xyz" ||
		ExtractReviewID("accounts/111/locations/222/reviews/SAMA") != ExtractReviewID("accounts/999/locations/888/reviews/SAMA") ||
		ExtractReviewID("hanya-id") != "hanya-id" {
		t.Fatal("ExtractReviewID")
	}
	if *ExtractLocationID("accounts/111/locations/222/reviews/ABC") != "222" || ExtractLocationID("hanya-id") != nil {
		t.Fatal("ExtractLocationID")
	}
	cases := map[string][]string{
		"locations/123": {"locations/123"}, "123": {"locations/123"},
		"locations/1, 2;locations/3  4": {"locations/1", "locations/2", "locations/3", "locations/4"},
		"locations/9,9,locations/9":     {"locations/9"}, "": {}, " , ; ": {}, "/locations/5/": {"locations/5"},
	}
	for in, want := range cases {
		if got := ParseLocationIDs(in); !slices.Equal(got, want) {
			t.Errorf("ParseLocationIDs(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestNeedsReplyApproval(t *testing.T) {
	m := ReplyApprovalMaxRating
	if !NeedsReplyApproval(1, false, m) || !NeedsReplyApproval(2, false, m) || NeedsReplyApproval(3, false, m) || NeedsReplyApproval(5, false, m) ||
		NeedsReplyApproval(1, true, m) || NeedsReplyApproval(2, true, m) || !NeedsReplyApproval(3, false, 3) || NeedsReplyApproval(2, false, 1) {
		t.Fatal("approval rule")
	}
}

func TestEvaluateReviewSLA(t *testing.T) {
	created := time.Date(2026, 7, 19, 10, 0, 0, 0, time.UTC)
	now := created.Add(time.Hour)
	if s := EvaluateReviewSLA(created, 120, nil, now); s.WaitingSeconds != 3600 || s.Breached {
		t.Fatalf("within: %+v", s)
	}
	if s := EvaluateReviewSLA(created, 30, nil, now); !s.Breached {
		t.Fatalf("breached: %+v", s)
	}
	replied := created.Add(15 * time.Minute)
	if s := EvaluateReviewSLA(created, 5, &replied, now); s.Breached || s.WaitingSeconds != 900 {
		t.Fatalf("replied: %+v", s)
	}
	if !EvaluateReviewSLA(time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC), 1440, nil, now).Breached {
		t.Fatal("old review breaches at once")
	}
}

func sign(body, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestVerifySignature(t *testing.T) {
	const secret = "rahasia-app-meta"
	body := `{"object":"instagram"}`
	if !VerifySignature([]byte(body), sign(body, secret), secret) {
		t.Fatal("valid signature")
	}
	if VerifySignature([]byte(body+" "), sign(body, secret), secret) ||
		VerifySignature([]byte(`{"a":1}`), sign(`{"a":1}`, "salah"), secret) ||
		VerifySignature([]byte(body), "", secret) || VerifySignature([]byte(body), sign(body, secret), "") ||
		VerifySignature([]byte("{}"), "sha256=pendek", secret) {
		t.Fatal("must reject")
	}
}

func TestSubscribeChallenge(t *testing.T) {
	q := url.Values{"hub.mode": {"subscribe"}, "hub.verify_token": {"token-uji"}, "hub.challenge": {"12345"}}
	if c, ok := SubscribeChallenge(q, "token-uji"); !ok || c != "12345" {
		t.Fatal("matching token")
	}
	q.Set("hub.verify_token", "salah")
	if _, ok := SubscribeChallenge(q, "token-uji"); ok {
		t.Fatal("wrong token")
	}
	q.Set("hub.verify_token", "")
	if _, ok := SubscribeChallenge(q, ""); ok {
		t.Fatal("unconfigured token")
	}
}

func webhook(messaging ...map[string]any) map[string]any {
	items := make([]any, len(messaging))
	for i, m := range messaging {
		items[i] = m
	}
	return map[string]any{"object": "instagram", "entry": []any{map[string]any{"messaging": items}}}
}

func TestNormalizeInstagramWebhook(t *testing.T) {
	msg := func(over map[string]any) map[string]any {
		m := map[string]any{"mid": "mid-1", "text": "halo"}
		for k, v := range over {
			m[k] = v
		}
		return map[string]any{"sender": map[string]any{"id": "IGSID-PELANGGAN"}, "recipient": map[string]any{"id": "IG-AKUN-BISNIS"},
			"timestamp": 1_700_000_000_000.0, "message": m}
	}
	got := NormalizeInstagramWebhook(webhook(msg(nil)))
	if len(got) != 1 || got[0].Channel != "instagram" || got[0].ExternalID != "IGSID-PELANGGAN" || got[0].Direction != "in" ||
		*got[0].Body != "halo" || got[0].Phone != nil || *got[0].ProviderMessageID != "mid-1" || got[0].SentAt.UnixMilli() != 1_700_000_000_000 {
		t.Fatalf("inbound: %+v", got)
	}
	echo := NormalizeInstagramWebhook(webhook(map[string]any{"sender": map[string]any{"id": "IG-AKUN-BISNIS"},
		"recipient": map[string]any{"id": "IGSID-PELANGGAN"}, "message": map[string]any{"mid": "mid-2", "text": "balasan", "is_echo": true}}))
	if echo[0].Direction != "out" || echo[0].ExternalID != "IGSID-PELANGGAN" {
		t.Fatalf("echo: %+v", echo)
	}
	if len(NormalizeInstagramWebhook(map[string]any{"object": "page", "entry": []any{}})) != 0 ||
		len(NormalizeInstagramWebhook(webhook(msg(map[string]any{"is_deleted": true})))) != 0 ||
		len(NormalizeInstagramWebhook(webhook(map[string]any{"sender": map[string]any{"id": "X"}, "message": map[string]any{}}))) != 0 ||
		len(NormalizeInstagramWebhook(map[string]any{})) != 0 || len(NormalizeInstagramWebhook(map[string]any{"object": "instagram"})) != 0 ||
		len(NormalizeInstagramWebhook(nil)) != 0 {
		t.Fatal("skips")
	}
	media := msg(nil)
	delete(media["message"].(map[string]any), "text")
	media["message"].(map[string]any)["attachments"] = []any{map[string]any{"type": "image"}}
	if m := NormalizeInstagramWebhook(webhook(media)); *m[0].MediaType != "image" || m[0].Body != nil {
		t.Fatalf("attachment: %+v", m)
	}
	many := map[string]any{"object": "instagram", "entry": []any{
		map[string]any{"messaging": []any{map[string]any{"sender": map[string]any{"id": "A"}, "message": map[string]any{"mid": "1", "text": "a"}}}},
		map[string]any{"messaging": []any{
			map[string]any{"sender": map[string]any{"id": "B"}, "message": map[string]any{"mid": "2", "text": "b"}},
			map[string]any{"sender": map[string]any{"id": "C"}, "message": map[string]any{"mid": "3", "text": "c"}},
		}},
	}}
	var ids []string
	for _, m := range NormalizeInstagramWebhook(many) {
		ids = append(ids, m.ExternalID)
	}
	if !slices.Equal(ids, []string{"A", "B", "C"}) {
		t.Fatalf("ids: %v", ids)
	}
}

func TestReplyWindow(t *testing.T) {
	now := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	if !WithinReplyWindow(ptr(time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC)), now) ||
		WithinReplyWindow(ptr(time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)), now) || WithinReplyWindow(nil, now) {
		t.Fatal("reply window")
	}
}

func TestMessagePreview(t *testing.T) {
	if MessagePreview(ptr("Halo"), nil) != "Halo" || UTF16Len(MessagePreview(ptr(strings.Repeat("y", 100)), nil)) != 80 ||
		MessagePreview(nil, ptr("image")) != "[image]" || MessagePreview(nil, nil) != "" {
		t.Fatal("preview")
	}
}

func TestOwnerMessages(t *testing.T) {
	want := "🚨 *Komplain Pelanggan Masuk*\n\nDari: 6281\nKategori: produk\n\nBuka CRM → Inbox WA untuk menangani."
	if got := KomplainMessage(nil, "6281", ptr("produk"), nil); got != want {
		t.Fatalf("komplain: %q", got)
	}
	got := ReviewRendahMessage("", 1, ptr("buruk"))
	if !strings.HasPrefix(got, "🚨 *Review Google Bintang Rendah*\n\n⭐ (1/5) dari Anonim\n\"buruk\"\n\n") {
		t.Fatalf("review: %q", got)
	}
}
