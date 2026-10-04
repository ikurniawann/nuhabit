package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func ptr(s string) *string { return &s }

func decode(t *testing.T, raw string) any {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// sales-target.test.ts
func TestSalesTarget(t *testing.T) {
	for raw, want := range map[string]SalesTarget{
		"{rusak": {},
		`{"harianRp":5000000,"bulananRp":120000000}`: {5_000_000, 120_000_000},
		`{"harianRp":-1,"bulananRp":3000000}`:        {0, 3_000_000},
		`{"harianRp":"Rp 1.500,","bulananRp":2.5}`:   {1500, 3},
		`null`: {},
	} {
		if got := ParseSalesTarget(ptr(raw)); got != want {
			t.Errorf("ParseSalesTarget(%s) = %+v, want %+v", raw, got, want)
		}
	}
	if ParseSalesTarget(nil) != (SalesTarget{}) {
		t.Error("nil should be 0/0")
	}

	base := SalesTarget{HarianRp: 7, BulananRp: 9}
	cases := []struct {
		body string
		want SalesTarget
		ok   bool
	}{
		{`{"harianRp":"5.000.000"}`, SalesTarget{5_000_000, 9}, true},
		{`{"harianRp":"abc"}`, base, false},
		{`{"bulananRp":1000000000000}`, base, false},
		{`{"bulananRp":90000000}`, SalesTarget{7, 90_000_000}, true},
		{`{"harianRp":0}`, SalesTarget{0, 9}, true},
		{`{"harianRp":null}`, base, false},
		{`{}`, base, true},
	}
	for _, c := range cases {
		got, ok := ApplySalesTargetInput(base, decode(t, c.body).(map[string]any))
		if got != c.want || ok != c.ok {
			t.Errorf("%s: got %+v %v, want %+v %v", c.body, got, ok, c.want, c.ok)
		}
	}
}

// appearance-tokens.test.ts (parseAppearanceTokens)
func TestParseAppearance(t *testing.T) {
	if ParseAppearance(nil) != DefaultAppearance || ParseAppearance("nope") != DefaultAppearance {
		t.Fatal("null / garbage should be the default")
	}
	parsed := ParseAppearance(decode(t, `{"base":{"primary":"0EA5E9"},"font":{"family":"inter","size":14}}`))
	if parsed.Base.Primary != "#0ea5e9" || parsed.Base.Background != DefaultAppearance.Base.Background ||
		parsed.Font != (AppearanceFont{"inter", 14}) {
		t.Fatalf("fills and normalizes: %+v", parsed)
	}
	if ParseAppearance(decode(t, `{"font":{"family":"comic","size":99}}`)).Font != DefaultAppearance.Font {
		t.Fatal("invalid font / size should fall back")
	}
	if ParseAppearance(decode(t, `{"font":{"family":"poppins","size":15}}`)).Font != (AppearanceFont{"poppins", 15}) {
		t.Fatal("expanded font families")
	}
	p := ParseAppearance(decode(t, `{"presetId":"ocean","sidebar":{"border":" #ABC "},"navbar":{"border":"#12345g"}}`))
	if p.PresetID != "ocean" || p.Sidebar.Border != "#aabbcc" || p.Navbar.Border != DefaultAppearance.Navbar.Border {
		t.Fatalf("preset and hex: %+v", p)
	}
	if ParseAppearance(decode(t, `{"presetId":"unknown"}`)).PresetID != "nuhabit" {
		t.Fatal("unknown preset falls back")
	}
	if len(fontFamilies) != 29 {
		t.Fatalf("FONT_STACKS has 29 keys, got %d", len(fontFamilies))
	}
}

// sort-warehouses.test.ts plus the order rules.
func TestSortWarehouses(t *testing.T) {
	rows := []Warehouse{
		{Code: "", Name: ""},
		{IsDefault: true, Code: "WH-01", Name: "Operasional"},
		{Code: "STALL-02", Name: "Yakitori"},
		{Code: "STALL-10", Name: "B"},
		{Code: "stall-3", Name: "C"},
		{Code: "MAIN", Name: "Main"},
		{Code: "A10", Name: "x"},
		{Code: "a2", Name: "y"},
	}
	SortWarehouses(rows, func(w Warehouse) Warehouse { return w })
	var codes []string
	for _, r := range rows {
		codes = append(codes, r.Code)
	}
	want := []string{"WH-01", "MAIN", "", "a2", "A10", "STALL-02", "stall-3", "STALL-10"}
	if !reflect.DeepEqual(codes, want) {
		t.Fatalf("order = %q, want %q", codes, want)
	}
}

func TestBusinessHelpers(t *testing.T) {
	for in, want := range map[string]string{
		"  PT Sulu Indah ":       "PT-SULU-INDAH",
		"-a-":                    "A",
		"Ünïcode café":           "N-CODE-CAF",
		strings.Repeat("ab", 20): strings.Repeat("AB", 15),
	} {
		if got := SlugCode(in); got != want {
			t.Errorf("SlugCode(%q) = %q, want %q", in, got, want)
		}
	}
	if name, code := NextWarehouse(0); name != "Stall 1" || code != "STALL-01" {
		t.Fatal(name, code)
	}
	if _, code := NextWarehouse(120); code != "STALL-121" {
		t.Fatal(code)
	}
}

// receipt-settings.test.ts
func TestReceipt(t *testing.T) {
	got := ReceiptLines(decode(t, `["  BCD Coffee  ", "", 42, null, "Dago"]`))
	if !reflect.DeepEqual(got, []string{"BCD Coffee", "Dago"}) {
		t.Fatal(got)
	}
	many := make([]any, 10)
	for i := range many {
		many[i] = "baris"
	}
	if len(ReceiptLines(many)) != ReceiptMaxLines {
		t.Fatal("line cap")
	}
	if l := ReceiptLines([]any{strings.Repeat("é", 100)}); len([]rune(l[0])) != ReceiptLineMaxChars {
		t.Fatal("length cap")
	}
	if ReceiptLines(nil) == nil || len(ReceiptLines("SULU")) != 0 {
		t.Fatal("non-arrays are []")
	}

	if _, err := ParseReceiptScope(map[string]any{"warehouse_id": "w"}); err != ErrWarehouseNeedsBranch {
		t.Fatal("warehouse needs branch")
	}
	in, _ := ParseReceiptScope(map[string]any{"branch_id": "", "show_stall_name": nil})
	if !in.IsGlobal() || !in.ShowStallName {
		t.Fatalf("%+v", in)
	}
	in, _ = ParseReceiptScope(map[string]any{"show_stall_name": false})
	if in.ShowStallName {
		t.Fatal("false is kept")
	}

	rows := []ReceiptRow{
		{ID: ptr("g")},
		{ID: ptr("b"), BranchID: ptr("br-1")},
		{ID: ptr("w"), BranchID: ptr("br-1"), WarehouseID: ptr("wh-1")},
	}
	for _, c := range []struct {
		scope ReceiptScope
		want  string
	}{
		{ReceiptScope{WarehouseID: ptr("wh-1"), BranchID: ptr("br-x")}, "w"},
		{ReceiptScope{BranchID: ptr("br-1")}, "b"},
		{ReceiptScope{}, "g"},
		{ReceiptScope{WarehouseID: ptr("wh-2"), BranchID: ptr("br-1")}, ""},
	} {
		row := FindReceiptScopeRow(rows, c.scope)
		if (row == nil && c.want != "") || (row != nil && *row.ID != c.want) {
			t.Errorf("%+v: got %v, want %q", c.scope, row, c.want)
		}
	}
}

// order-alert.test.ts (parseOrderAlertConfig, isTelegramBotToken)
func TestOrderAlert(t *testing.T) {
	def := OrderAlertConfig{WaEnabled: true, WaRoles: []string{"pos"}, TelegramEnabled: true}
	for _, raw := range []*string{nil, ptr("{rusak"), ptr("null"), ptr("")} {
		if got := ParseOrderAlertConfig(raw); !reflect.DeepEqual(got, def) {
			t.Fatalf("%v: %+v", raw, got)
		}
	}
	got := ParseOrderAlertConfig(ptr(`{"waEnabled":false,"waRoles":["pos_supervisor","super_admin"],"telegramEnabled":false}`))
	if !reflect.DeepEqual(got, OrderAlertConfig{WaRoles: []string{"pos_supervisor"}}) {
		t.Fatalf("%+v", got)
	}
	if !IsTelegramBotToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw") || IsTelegramBotToken("bukan-token") ||
		IsTelegramBotToken("123:abc") {
		t.Fatal("isTelegramBotToken")
	}
	for in, want := range map[string]string{"0812-3456-7890": "6281234567890", "+62 812 3456 789": "628123456789", "812345678": "62812345678"} {
		if got := NormalizeWaPhone(ptr(in)); got == nil || *got != want {
			t.Errorf("NormalizeWaPhone(%q) = %v", in, got)
		}
	}
	if NormalizeWaPhone(ptr("0812")) != nil || NormalizeWaPhone(ptr("abc")) != nil || NormalizeWaPhone(nil) != nil {
		t.Fatal("invalid phones are nil")
	}
	if m := MaskPhone(ptr("6281234567890")); *m != "6281••••890" || MaskPhone(nil) != nil {
		t.Fatal(*m)
	}
}

// catalog.test.ts
func TestTtsCatalog(t *testing.T) {
	if !IsTtsProviderID("azure") || IsTtsProviderID("aws") || IsTtsProviderID(nil) {
		t.Fatal("isTtsProviderId")
	}
	if GetTtsProvider("provider-yang-sudah-dihapus").ID != "openai" {
		t.Fatal("unknown provider falls back to openai")
	}
	for _, c := range []struct {
		provider string
		voice    any
		want     string
	}{
		{"openai", "nova", "nova"},
		{"openai", "id-ID-GadisNeural", "coral"},
		{"azure", "id-ID-LainnyaNeural", "id-ID-LainnyaNeural"},
		{"elevenlabs", "voice-hasil-cloning", "voice-hasil-cloning"},
		{"azure", "   ", "id-ID-GadisNeural"},
		{"openai", nil, "coral"},
		{"azure", "  id-ID-ArdiNeural  ", "id-ID-ArdiNeural"},
	} {
		if got := ResolveTtsVoice(c.provider, c.voice); got != c.want {
			t.Errorf("ResolveTtsVoice(%s, %v) = %s", c.provider, c.voice, got)
		}
	}
	if ResolveTtsModel("openai", "tts-1-hd") != "tts-1-hd" || ResolveTtsModel("openai", "tts-9") != "gpt-4o-mini-tts" ||
		ResolveTtsModel("elevenlabs", "") != "eleven_multilingual_v2" {
		t.Fatal("resolveTtsModel")
	}
	for _, p := range []TtsProvider{TtsProviders.OpenAI, TtsProviders.Azure, TtsProviders.ElevenLabs} {
		if !reflect.DeepEqual(GetTtsProvider(p.ID), p) {
			t.Fatalf("GetTtsProvider(%s)", p.ID)
		}
		found := false
		for _, m := range p.Models {
			found = found || m == p.DefaultModel
		}
		if !found {
			t.Fatalf("%s default model not in models", p.ID)
		}
		for _, v := range p.Voices {
			if v.NativeIndonesian != (p.ID == "azure") {
				t.Fatalf("%s/%s native flag", p.ID, v.ID)
			}
		}
	}
}

func TestSliceJS(t *testing.T) {
	if SliceJS("a😀b", 3) != "a😀" || SliceJS("abc", 5) != "abc" {
		t.Fatal("slice counts UTF-16 units")
	}
	if TrimJS(string([]rune{0xa0, ' ', 'x', ' ', 0xfeff})) != "x" {
		t.Fatal("trim")
	}
}
