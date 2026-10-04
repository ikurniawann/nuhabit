package whatsapp

import (
	"context"
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strings"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jsmath"
)

/* ── configuration.wa_notif_log claims ───────────────────────────────── */

// Claim inserts the dedup row of one event before it is sent, so two
// processes never send it twice. It returns the row id, "" when the key
// was already claimed.
func Claim(ctx context.Context, q database.Querier, notifType, dedupKey, message string, recipients []string) (string, error) {
	if recipients == nil {
		recipients = []string{}
	}
	list, _ := json.Marshal(recipients)
	var id string
	err := q.QueryRow(ctx, `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
		VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (notif_type, dedup_key) DO NOTHING
		RETURNING id::text`, notifType, dedupKey, message, string(list)).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

// Release drops a claim whose send clearly failed, so the event is retried.
func Release(ctx context.Context, q database.Querier, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM configuration.wa_notif_log WHERE id = $1::uuid`, id)
	return err
}

/* ── wa_notif_config (lib/wa/notifications-config.ts) ────────────────── */

// NotifConfig is the part of WaNotifConfig the senders read.
type NotifConfig struct {
	Enabled    bool
	Recipients []string
	// Types maps each WaNotifType to its switch; unknown types are off.
	Types           map[string]bool
	VoidThresholdRp float64
}

// notifTypes are WA_NOTIF_TYPES; every one defaults on.
var notifTypes = []string{"voidBesar", "stokHabis", "komplain", "prMendesak", "reviewRendah", "digest", "omzetAnjlok", "approvalMenginap", "kontrakHabis"}

const maxRecipients = 5

// ParseNotifConfig is parseWaNotifConfig: a broken or partial value falls
// back to the defaults per field (master switch off, every type on, void
// threshold Rp500.000).
func ParseNotifConfig(raw string) NotifConfig {
	cfg := NotifConfig{Types: map[string]bool{}, VoidThresholdRp: 500_000}
	for _, t := range notifTypes {
		cfg.Types[t] = true
	}
	var o map[string]any
	if raw == "" || json.Unmarshal([]byte(raw), &o) != nil || o == nil {
		return cfg
	}
	if list, ok := o["recipients"].([]any); ok {
		var valid []string
		for _, r := range list {
			if s, ok := r.(string); ok {
				if n := NormalizeRecipient(s); n != "" {
					valid = append(valid, n)
				}
			}
		}
		for _, n := range valid[:min(len(valid), maxRecipients)] {
			if !slices.Contains(cfg.Recipients, n) {
				cfg.Recipients = append(cfg.Recipients, n)
			}
		}
	}
	if types, ok := o["types"].(map[string]any); ok {
		for _, t := range notifTypes {
			if v, ok := types[t].(bool); ok {
				cfg.Types[t] = v
			}
		}
	}
	if v, ok := o["voidThresholdRp"].(float64); ok && v >= 0 && !math.IsInf(v, 0) {
		cfg.VoidThresholdRp = jsmath.Round(v)
	}
	if v, ok := o["enabled"].(bool); ok {
		cfg.Enabled = v
	}
	return cfg
}

var recipientPattern = regexp.MustCompile(`^62\d{8,13}$`)

// NormalizeRecipient is normalizeWaRecipient: 08…, +62… or 62… (spaces and
// dashes allowed) → 62xxxxxxxxxx, "" when invalid.
func NormalizeRecipient(raw string) string {
	var b strings.Builder
	for _, c := range raw {
		if (c >= '0' && c <= '9') || c == '+' {
			b.WriteRune(c)
		}
	}
	n := strings.TrimPrefix(b.String(), "+")
	if strings.HasPrefix(n, "0") {
		n = "62" + n[1:]
	}
	if !recipientPattern.MatchString(n) {
		return ""
	}
	return n
}

// LoadNotifConfig is getWaNotifConfig.
func LoadNotifConfig(ctx context.Context, q database.Querier) (NotifConfig, error) {
	var raw *string
	err := q.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = 'wa_notif_config'`).Scan(&raw)
	if err != nil && !database.IsNoRows(err) {
		return NotifConfig{}, err
	}
	if raw == nil {
		return ParseNotifConfig(""), nil
	}
	return ParseNotifConfig(*raw), nil
}

// SendOwnerNotification is sendOwnerNotification: silent when the master
// switch or the type is off, nobody is listed or the gateway is not set up;
// otherwise the dedup key is claimed on q and the message goes to every
// recipient through the gateway. The claim is released when every send
// clearly failed; a timeout keeps it (at most once). cfg nil loads it.
func (c *Client) SendOwnerNotification(ctx context.Context, q database.Querier, notifType, dedupKey, message string, cfg *NotifConfig) error {
	if cfg == nil {
		loaded, err := LoadNotifConfig(ctx, q)
		if err != nil {
			return err
		}
		cfg = &loaded
	}
	if !cfg.Enabled || !cfg.Types[notifType] || len(cfg.Recipients) == 0 {
		return nil
	}
	gateway := c.LoadGateway(ctx, q)
	if gateway == nil {
		return nil
	}
	id, err := Claim(ctx, q, notifType, dedupKey, message, cfg.Recipients)
	if err != nil || id == "" {
		return err
	}
	delivered, timedOut := 0, false
	for _, to := range cfg.Recipients {
		switch res := gateway.SendText(ctx, to, message); {
		case res.Success:
			delivered++
		case res.TimedOut:
			timedOut = true
		default:
			c.Log.Error("[wa-notif] gagal kirim ke " + to + ": " + res.Reason)
		}
	}
	if delivered == 0 && !timedOut {
		return Release(ctx, q, id)
	}
	return nil
}
