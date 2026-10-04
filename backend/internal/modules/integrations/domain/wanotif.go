package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Owner WhatsApp notification settings (lib/wa/notifications-config.ts and
// lib/settings/wa-notifications.ts), stored as one JSON value under
// configuration.app_settings 'wa_notif_config'.

// WaNotifSettingKey is WA_NOTIF_SETTING_KEY.
const WaNotifSettingKey = "wa_notif_config"

// WaNotifType is one entry of WA_NOTIF_TYPES (the settings page catalog).
type WaNotifType struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Tier        string `json:"tier"`
	DefaultOn   bool   `json:"defaultOn"`
}

// WaNotifTypes is WA_NOTIF_TYPES, in catalog order.
var WaNotifTypes = []WaNotifType{
	{"voidBesar", "Pesanan di-void bernilai besar", "Void/pembatalan di atas ambang nominal — sinyal fraud paling umum di POS.", "kritis", true},
	{"stokHabis", "Stok bahan benar-benar habis", "Bahan mencapai nol (bukan sekadar di bawah minimum) — operasional berhenti.", "kritis", true},
	{"komplain", "Komplain pelanggan masuk", "Komplain baru dari WhatsApp Customer Service.", "kritis", true},
	{"prMendesak", "Purchase Request mendesak", "PR berprioritas Mendesak dibuat atau diajukan — butuh persetujuan cepat (permintaan owner 2026-09-04).", "kritis", true},
	{"reviewRendah", "Review Google bintang rendah", "Review masuk dengan rating ≤ 2 — reputasi butuh respons cepat.", "kritis", true},
	{"digest", "Ringkasan harian jam tutup", "Satu pesan: omzet vs kemarin, kehadiran, antrean keputusan, stok menipis.", "harian", true},
	{"omzetAnjlok", "Omzet bulan berjalan anjlok", "Omzet month-to-date jauh di bawah pace target bulanan (bila diisi) atau MTD bulan lalu — keputusan owner 2026-07-22.", "ambang", true},
	{"approvalMenginap", "Approval menginap", "Pengajuan cuti/lembur/pinjaman/PO yang menunggu lebih dari 2 hari.", "ambang", true},
	{"kontrakHabis", "Kontrak karyawan mendekati habis", "Kontrak PKWT yang berakhir dalam 30 hari.", "ambang", true},
}

const (
	maxNotifRecipients        = 5
	maxShiftReportRecipients  = 10
	defaultVoidThresholdRp    = 500_000
	defaultDigestHour         = 22
	defaultOmzetAnjlokPercent = 80
)

// NotifSwitches maps each type key to its switch, written in catalog order.
type NotifSwitches map[string]bool

// MarshalJSON keeps the catalog order (Object.fromEntries over WA_NOTIF_TYPES).
func (s NotifSwitches) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, t := range WaNotifTypes {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%q:%t", t.Key, s[t.Key])
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// WaNotifConfig is WaNotifConfig, keys in the TS order.
type WaNotifConfig struct {
	Enabled         bool          `json:"enabled"`
	Recipients      []string      `json:"recipients"`
	Types           NotifSwitches `json:"types"`
	VoidThresholdRp float64       `json:"voidThresholdRp"`
	DigestHour      int           `json:"digestHour"`
	OmzetAnjlokPct  int           `json:"omzetAnjlokPct"`
}

// DefaultWaNotifConfig is defaultWaNotifConfig: off until the owner turns
// it on, every type on.
func DefaultWaNotifConfig() WaNotifConfig {
	types := NotifSwitches{}
	for _, t := range WaNotifTypes {
		types[t.Key] = t.DefaultOn
	}
	return WaNotifConfig{Recipients: []string{}, Types: types, VoidThresholdRp: defaultVoidThresholdRp,
		DigestHour: defaultDigestHour, OmzetAnjlokPct: defaultOmzetAnjlokPercent}
}

// isInt is Number.isInteger.
func isInt(f float64) bool { return finite(f) && f == math.Trunc(f) }

// ParseWaNotifConfig is parseWaNotifConfig: a broken or partial stored
// value falls back to the default per field.
func ParseWaNotifConfig(raw *string) WaNotifConfig {
	cfg := DefaultWaNotifConfig()
	if raw == nil || *raw == "" {
		return cfg
	}
	parsed, ok := ParseJSON([]byte(*raw))
	if !ok {
		return cfg
	}
	o := Obj(parsed)
	if o == nil {
		return cfg
	}
	if list, ok := o["recipients"].([]any); ok {
		var valid []string
		for _, r := range list {
			if s, ok := r.(string); ok {
				if n := whatsapp.NormalizeRecipient(s); n != "" {
					valid = append(valid, n)
				}
			}
		}
		cfg.Recipients = []string{}
		for _, n := range valid[:min(len(valid), maxNotifRecipients)] {
			if !slices.Contains(cfg.Recipients, n) {
				cfg.Recipients = append(cfg.Recipients, n)
			}
		}
	}
	if types := Obj(o["types"]); types != nil {
		for _, t := range WaNotifTypes {
			if v, ok := types[t.Key].(bool); ok {
				cfg.Types[t.Key] = v
			}
		}
	}
	if f, ok := number(o["voidThresholdRp"]); ok && finite(f) && f >= 0 {
		cfg.VoidThresholdRp = jsmath.Round(f)
	}
	if f, ok := number(o["digestHour"]); ok && isInt(f) && f >= 0 && f <= 23 {
		cfg.DigestHour = int(f)
	}
	if f, ok := number(o["omzetAnjlokPct"]); ok && isInt(f) && f >= 1 && f <= 99 {
		cfg.OmzetAnjlokPct = int(f)
	}
	if v, ok := o["enabled"].(bool); ok {
		cfg.Enabled = v
	}
	return cfg
}

// number is v when typeof v === "number".
func number(v any) (float64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := n.Float64()
	return f, err == nil
}

// ApplyWaNotifUpdate is applyWaNotifUpdate: a partial PUT over the stored
// config. The error is the 400 message of the first invalid field.
func ApplyWaNotifUpdate(current WaNotifConfig, body map[string]any) (WaNotifConfig, string) {
	next := current
	next.Types = NotifSwitches{}
	for k, v := range current.Types {
		next.Types[k] = v
	}
	if v, sent := body["enabled"]; sent {
		b, ok := v.(bool)
		if !ok {
			return next, "enabled tidak valid"
		}
		next.Enabled = b
	}
	if v, sent := body["recipients"]; sent {
		list, msg := cleanOwnerRecipients(v)
		if msg != "" {
			return next, msg
		}
		next.Recipients = list
	}
	if v, sent := body["types"]; sent {
		if !Truthy(v) || !isObject(v) {
			return next, "types tidak valid"
		}
		types := Obj(v)
		for _, t := range WaNotifTypes {
			if b, ok := types[t.Key].(bool); ok {
				next.Types[t.Key] = b
			}
		}
	}
	if v, sent := body["voidThresholdRp"]; sent {
		n := jsNumber(v)
		if !finite(n) || n < 0 {
			return next, "Ambang void tidak valid"
		}
		next.VoidThresholdRp = jsmath.Round(n)
	}
	if v, sent := body["digestHour"]; sent {
		n := jsNumber(v)
		if !isInt(n) || n < 0 || n > 23 {
			return next, "Jam ringkasan harus 0-23 (WIB)"
		}
		next.DigestHour = int(n)
	}
	if v, sent := body["omzetAnjlokPct"]; sent {
		n := jsNumber(v)
		if !isInt(n) || n < 1 || n > 99 {
			return next, "Ambang omzet harus 1-99 (persen dari baseline)"
		}
		next.OmzetAnjlokPct = int(n)
	}
	return next, ""
}

// isObject is typeof v === "object" (arrays included, null excluded).
func isObject(v any) bool {
	switch v.(type) {
	case map[string]any, []any:
		return true
	}
	return false
}

func cleanOwnerRecipients(v any) ([]string, string) {
	list, ok := v.([]any)
	if !ok {
		return nil, "recipients tidak valid"
	}
	cleaned := []string{}
	for _, raw := range list {
		s, ok := raw.(string)
		if !ok {
			continue
		}
		n := whatsapp.NormalizeRecipient(s)
		if n == "" {
			return nil, "Nomor tidak valid: " + s + ". Pakai format 08… atau 62…"
		}
		if !slices.Contains(cleaned, n) {
			cleaned = append(cleaned, n)
		}
	}
	if len(cleaned) > maxNotifRecipients {
		return nil, fmt.Sprintf("Maksimal %d nomor penerima", maxNotifRecipients)
	}
	return cleaned, ""
}

// CleanShiftReportRecipients is cleanShiftReportRecipients: digits and "+"
// only, at least 9 characters, unique, at most 10. ok=false when v is not
// an array ("shift_report_recipients tidak valid").
func CleanShiftReportRecipients(v any) ([]string, bool) {
	list, ok := v.([]any)
	if !ok {
		return nil, false
	}
	out := []string{}
	for _, item := range list {
		var b strings.Builder
		for _, c := range jsString(item) {
			if (c >= '0' && c <= '9') || c == '+' {
				b.WriteRune(c)
			}
		}
		if s := b.String(); len(s) >= 9 && !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	return out[:min(len(out), maxShiftReportRecipients)], true
}

// ParseShiftReportRecipients is parseShiftReportRecipients: the stored JSON
// array as strings; anything else is empty.
func ParseShiftReportRecipients(raw *string) []string {
	out := []string{}
	if raw == nil || *raw == "" {
		return out
	}
	parsed, _ := ParseJSON([]byte(*raw))
	list, _ := parsed.([]any)
	for _, item := range list {
		out = append(out, jsString(item))
	}
	return out
}
