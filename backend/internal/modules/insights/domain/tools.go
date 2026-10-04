package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// Do tool rules (lib/assistant/{tools,write-tools,tool-scope}.ts): which
// tools a user may call, their OpenAI definitions, and argument parsing.

// ToolRowLimit caps every read tool query.
const ToolRowLimit = 25

// Tool names.
const (
	ToolCariKaryawan     = "cari_karyawan"
	ToolAbsensiHariIni   = "absensi_hari_ini"
	ToolStokMenipis      = "stok_menipis"
	ToolPenjualanPeriode = "penjualan_periode"
	ToolStatusKandidat   = "status_kandidat"
	ActionPengumuman     = "usulkan_pengumuman_draft"
	ActionCatatan        = "usulkan_catatan_kandidat"
)

// toolPrefixes is TOOL_IAM_PREFIXES in declaration order.
var toolPrefixes = []struct {
	name     string
	prefixes []string
}{
	{ToolCariKaryawan, []string{"hris.kepegawaian", "hris.workforce", "hris"}},
	{ToolAbsensiHariIni, []string{"hris.workforce", "hris"}},
	{ToolStokMenipis, []string{"items.raw-material", "items", "pos.catalog"}},
	{ToolPenjualanPeriode, []string{"pos.reports", "pos"}},
	{ToolStatusKandidat, []string{"hris.recruitment"}},
	{ActionPengumuman, []string{"hris"}},
	{ActionCatatan, []string{"hris.recruitment"}},
}

// fullAccessRoles get every tool without a menu mapping.
var fullAccessRoles = []string{"super_admin", "admin", "direksi"}

func hasIamPrefix(granted, prefixes []string) bool {
	for _, p := range prefixes {
		for _, code := range granted {
			if code == p || strings.HasPrefix(code, p+".") {
				return true
			}
		}
	}
	return false
}

// AllowedToolNames maps a role and its granted menu codes to tool names.
// Without any grant only the full-access roles get tools.
func AllowedToolNames(role string, granted []string) []string {
	names := []string{}
	full := slices.Contains(fullAccessRoles, role)
	if !full && len(granted) == 0 {
		return names
	}
	for _, t := range toolPrefixes {
		if full || hasIamPrefix(granted, t.prefixes) {
			names = append(names, t.name)
		}
	}
	return names
}

// ToolDef is one entry of the OpenAI tools list.
type ToolDef struct {
	Type     string      `json:"type"`
	Function ToolDefFunc `json:"function"`
}

// ToolDefFunc is the function part of a ToolDef.
type ToolDefFunc struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

func def(name, description, params string) ToolDef {
	return ToolDef{Type: "function", Function: ToolDefFunc{Name: name, Description: description, Parameters: json.RawMessage(params)}}
}

// ReadToolDefs is toolDefinitions(), in ASSISTANT_TOOLS order.
var ReadToolDefs = []ToolDef{
	def(ToolCariKaryawan,
		"Cari karyawan berdasarkan sebagian nama atau NIP. Mengembalikan nama, NIP, jabatan, departemen, status aktif, dan tanggal bergabung.",
		`{"type":"object","properties":{"nama":{"type":"string","description":"Sebagian nama atau NIP karyawan"}},"required":["nama"]}`),
	def(ToolAbsensiHariIni,
		"Ringkasan kehadiran pada satu tanggal: berapa yang sudah absen, terlambat, dan daftar karyawan aktif yang belum absen. Tanpa argumen berarti hari ini.",
		`{"type":"object","properties":{"tanggal":{"type":"string","description":"Tanggal YYYY-MM-DD; kosongkan untuk hari ini"}}}`),
	def(ToolStokMenipis,
		"Daftar bahan baku yang stok tersedianya sudah di bawah atau sama dengan batas minimum, beserta jumlah yang sedang dipesan.",
		`{"type":"object","properties":{}}`),
	def(ToolPenjualanPeriode,
		"Ringkasan penjualan POS pada rentang tanggal: jumlah pesanan, total omzet, dan rata-rata per pesanan. Hanya menghitung pesanan yang tidak dibatalkan.",
		`{"type":"object","properties":{"dari":{"type":"string","description":"Tanggal mulai YYYY-MM-DD"},"sampai":{"type":"string","description":"Tanggal akhir YYYY-MM-DD"}}}`),
	def(ToolStatusKandidat,
		"Cari kandidat rekrutmen berdasarkan nama, atau tampilkan kandidat terbaru bila nama dikosongkan. Mengembalikan status pipeline dan sumber lamaran.",
		`{"type":"object","properties":{"nama":{"type":"string","description":"Sebagian nama kandidat; boleh dikosongkan"},"batas":{"type":"number","description":"Jumlah baris maksimum (default 10)"}}}`),
}

// WriteToolDefs is writeToolDefinitions(), in ASSISTANT_WRITE_ACTIONS order.
var WriteToolDefs = []ToolDef{
	def(ActionPengumuman,
		"Siapkan DRAFT pengumuman perusahaan (tidak langsung terbit; user harus konfirmasi dulu, lalu HRD mempublikasikan dari CMS Pengumuman). Gunakan saat user minta dibuatkan pengumuman.",
		`{"type":"object","properties":{"judul":{"type":"string","description":"Judul pengumuman (3-150 karakter)"},"isi":{"type":"string","description":"Isi pengumuman dalam teks polos (10-5000 karakter)"},"tags":{"type":"array","items":{"type":"string"},"description":"Maksimal 5 tag pendek, opsional"}},"required":["judul","isi"]}`),
	def(ActionCatatan,
		"Siapkan catatan internal HR pada timeline seorang kandidat rekrutmen (butuh konfirmasi user sebelum tercatat). Gunakan saat user minta mencatat sesuatu tentang kandidat.",
		`{"type":"object","properties":{"kandidat":{"type":"string","description":"Nama kandidat (sebisa mungkin nama lengkap)"},"catatan":{"type":"string","description":"Isi catatan (3-2000 karakter)"}},"required":["kandidat","catatan"]}`),
}

// IsWriteAction reports a whitelisted write action name.
func IsWriteAction(name string) bool { return name == ActionPengumuman || name == ActionCatatan }

// ParseToolArguments reads the model's JSON arguments; anything but a JSON
// object is an empty argument set.
func ParseToolArguments(raw any) map[string]any {
	s, ok := raw.(string)
	if !ok || Trim(s) == "" {
		return map[string]any{}
	}
	var parsed any
	if json.Unmarshal([]byte(s), &parsed) != nil {
		return map[string]any{}
	}
	if m, ok := parsed.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// ArgString is a trimmed string argument ("" for other types).
func ArgString(args map[string]any, key string) string {
	if s, ok := args[key].(string); ok {
		return Trim(s)
	}
	return ""
}

var leadingInt = regexp.MustCompile(`^[+-]?\d+`)

// ArgInt is a number argument or parseInt(String(value), 10), else fallback.
func ArgInt(args map[string]any, key string, fallback float64) float64 {
	switch v := args[key].(type) {
	case float64:
		if math.IsInf(v, 0) || math.IsNaN(v) {
			return fallback
		}
		return v
	case nil:
		return fallback
	default:
		m := leadingInt.FindString(strings.TrimLeft(JSString(v), trimSet))
		if m == "" {
			return fallback
		}
		n, err := strconv.ParseFloat(m, 64)
		if err != nil || math.IsInf(n, 0) {
			return fallback
		}
		return n
	}
}

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ArgDate is a YYYY-MM-DD argument, "" when absent or malformed.
func ArgDate(args map[string]any, key string) string {
	if v := ArgString(args, key); isoDate.MatchString(v) {
		return v
	}
	return ""
}

// EscapeHTML escapes model text before it becomes HTML.
func EscapeHTML(v string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(v)
}

var paragraphBreak = regexp.MustCompile(`\n{2,}`)

// PlainTextToHTML wraps blank-line separated blocks in <p>, newlines as <br />.
func PlainTextToHTML(v string) string {
	var out []string
	for _, block := range paragraphBreak.Split(v, -1) {
		if block = Trim(block); block != "" {
			out = append(out, "<p>"+strings.ReplaceAll(EscapeHTML(block), "\n", "<br />")+"</p>")
		}
	}
	return strings.Join(out, "\n")
}

// Pengumuman is a validated announcement draft.
type Pengumuman struct {
	Judul string   `json:"judul"`
	Isi   string   `json:"isi"`
	Tags  []string `json:"tags"`
}

// ValidatePengumuman checks title 3-150, body 10-5000 and up to 5 tags of
// 1-30 characters (other tags are dropped).
func ValidatePengumuman(args map[string]any) (Pengumuman, string) {
	judul, isi := ArgString(args, "judul"), ArgString(args, "isi")
	if n := Len(judul); n < 3 || n > 150 {
		return Pengumuman{}, "Judul harus 3-150 karakter"
	}
	if n := Len(isi); n < 10 || n > 5000 {
		return Pengumuman{}, "Isi pengumuman harus 10-5000 karakter"
	}
	tags := []string{}
	raw, _ := args["tags"].([]any)
	for _, t := range raw {
		s, ok := t.(string)
		if !ok {
			continue
		}
		if s = Trim(s); s != "" && Len(s) <= 30 && len(tags) < 5 {
			tags = append(tags, s)
		}
	}
	return Pengumuman{Judul: judul, Isi: isi, Tags: tags}, ""
}

// CatatanKandidat is a validated candidate note request.
type CatatanKandidat struct {
	Kandidat string `json:"kandidat"`
	Catatan  string `json:"catatan"`
}

// ValidateCatatanKandidat checks name 2-100 and note 3-2000 characters.
func ValidateCatatanKandidat(args map[string]any) (CatatanKandidat, string) {
	kandidat, catatan := ArgString(args, "kandidat"), ArgString(args, "catatan")
	if n := Len(kandidat); n < 2 || n > 100 {
		return CatatanKandidat{}, "Nama kandidat harus 2-100 karakter"
	}
	if n := Len(catatan); n < 3 || n > 2000 {
		return CatatanKandidat{}, "Catatan harus 3-2000 karakter"
	}
	return CatatanKandidat{Kandidat: kandidat, Catatan: catatan}, ""
}

// Truncate cuts v to max characters, the last one an ellipsis.
func Truncate(v string, max int) string {
	if Len(v) > max {
		return Slice(v, max-1) + "…"
	}
	return v
}
