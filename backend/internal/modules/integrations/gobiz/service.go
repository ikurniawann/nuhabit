package gobiz

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/integrations/gobiz/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/database"
	gobizapi "nuhabit/backend/internal/platform/gobiz"
	"nuhabit/backend/internal/platform/httpx"
)

// ErrNotConfigured is GobizNotConfiguredError.
var ErrNotConfigured = errors.New("GoBiz belum dikonfigurasi — isi Client ID, Client Secret, dan Outlet ID di Settings → Integrasi")

// Service is lib/gobiz/service.ts for the settings page and the webhook.
// The webhook steps run one statement at a time like the TS, so a failed
// event still keeps its gofood_events row (result=error) for a retry.
type Service struct {
	db  database.DB
	p   Ports
	api *gobizapi.Client
	now func() time.Time
	log *slog.Logger
}

// settings is getSettings over every gobiz_* key.
func (s *Service) settings(ctx context.Context) (appsettings.Values, error) {
	return appsettings.GetMany(ctx, s.db, gobizapi.SettingKeys...)
}

// Config is loadGobizConfig.
func (s *Service) Config(ctx context.Context) (gobizapi.Config, error) {
	v, err := s.settings(ctx)
	if err != nil {
		return gobizapi.Config{}, err
	}
	return gobizapi.ConfigFromSettings(v), nil
}

func (s *Service) requireConfig(ctx context.Context) (gobizapi.Config, error) {
	cfg, err := s.Config(ctx)
	if err == nil && !cfg.IsConfigured() {
		err = ErrNotConfigured
	}
	return cfg, err
}

// generateWebhookToken is generateWebhookToken: 24 random bytes as hex.
func generateWebhookToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ensureWebhookToken creates the webhook token once and keeps it.
func (s *Service) ensureWebhookToken(ctx context.Context) (string, error) {
	current, err := appsettings.Get(ctx, s.db, gobizapi.KeyWebhookToken)
	if err != nil {
		return "", err
	}
	if current != nil {
		if t := domain.JSTrim(*current); t != "" {
			return t, nil
		}
	}
	token := generateWebhookToken()
	return token, appsettings.Set(ctx, s.db, gobizapi.KeyWebhookToken, &token)
}

// webhookToken is `config.webhookToken || await ensureWebhookToken()`.
func (s *Service) webhookToken(ctx context.Context, cfg gobizapi.Config) (string, error) {
	if cfg.WebhookToken != "" {
		return cfg.WebhookToken, nil
	}
	return s.ensureWebhookToken(ctx)
}

/* ── settings actions ─────────────────────────────────────────────────── */

type connectionTest struct {
	OK           bool   `json:"ok"`
	Environment  string `json:"environment"`
	TokenPreview string `json:"token_preview"`
}

// TestConnection is testGobizConnection: fetch an OAuth token.
func (s *Service) TestConnection(ctx context.Context) (any, error) {
	cfg, err := s.requireConfig(ctx)
	if err != nil {
		return nil, err
	}
	token, err := s.api.AccessToken(ctx, cfg)
	if err != nil {
		return nil, err
	}
	units := utf16.Encode([]rune(token))
	return connectionTest{true, cfg.Environment, string(utf16.Decode(units[:min(6, len(units))])) + "…"}, nil
}

type subscription struct {
	Event string `json:"event"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// RegisterWebhooks is registerGobizWebhooks: subscribe the webhook URL to
// every GoFood event; a failure is reported per event.
func (s *Service) RegisterWebhooks(ctx context.Context, appURL string) (any, error) {
	cfg, err := s.requireConfig(ctx)
	if err != nil {
		return nil, err
	}
	token, err := s.webhookToken(ctx, cfg)
	if err != nil {
		return nil, err
	}
	url := domain.WebhookURL(appURL, token)
	results := make([]subscription, 0, len(domain.WebhookEvents))
	for _, event := range domain.WebhookEvents {
		if err := s.api.Subscribe(ctx, cfg, event, url); err != nil {
			results = append(results, subscription{Event: event, Error: errorMessage(err)})
			continue
		}
		results = append(results, subscription{Event: event, OK: true})
	}
	return struct {
		URL     string         `json:"url"`
		Results []subscription `json:"results"`
	}{url, results}, nil
}

type catalogSync struct {
	RequestID string              `json:"request_id"`
	Stats     domain.CatalogStats `json:"stats"`
	Response  json.RawMessage     `json:"response"`
}

// SyncCatalog is syncCatalogToGobiz: push the POS catalog at GoFood prices
// and log the attempt in pos.gofood_catalog_syncs.
func (s *Service) SyncCatalog(ctx context.Context, appURL string) (any, error) {
	cfg, err := s.requireConfig(ctx)
	if err != nil {
		return nil, err
	}
	products, err := s.p.Catalog.GofoodProducts(ctx, s.db)
	if err != nil {
		return nil, err
	}
	rule, err := s.p.Catalog.ChannelRule(ctx, s.db, "gofood")
	if err != nil {
		return nil, err
	}
	overrides, err := s.p.Catalog.ChannelOverrides(ctx, s.db, "gofood")
	if err != nil {
		return nil, err
	}
	// GoFood prices (markup + manual prices); no channel row = base prices.
	if rule != nil {
		products = domain.PriceForChannel(products, *rule, overrides)
	}
	requestID := newUUID()
	payload, stats := domain.BuildCatalog(products, appURL, requestID)

	var syncID *string
	if err := s.db.QueryRow(ctx, `INSERT INTO pos.gofood_catalog_syncs (request_id, item_count, status) VALUES ($1, $2, 'sent') RETURNING id::text`,
		requestID, stats.Items).Scan(&syncID); err != nil {
		return nil, err
	}
	response, err := s.api.PushCatalog(ctx, cfg, payload)
	if err != nil {
		if _, uerr := s.db.Exec(ctx, `UPDATE pos.gofood_catalog_syncs SET status = 'failed', error = $2 WHERE id = $1`, syncID, errorMessage(err)); uerr != nil {
			return nil, uerr
		}
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `UPDATE pos.gofood_catalog_syncs SET status = 'success', response = $2 WHERE id = $1`, syncID, []byte(response)); err != nil {
		return nil, err
	}
	return catalogSync{requestID, stats, response}, nil
}

// RegenerateToken is the regenerate_token action: a new webhook token
// (GoBiz must be re-registered).
func (s *Service) RegenerateToken(ctx context.Context, appURL string) (any, error) {
	token := generateWebhookToken()
	if err := appsettings.Set(ctx, s.db, gobizapi.KeyWebhookToken, &token); err != nil {
		return nil, err
	}
	return struct {
		WebhookURL string `json:"webhook_url"`
	}{domain.WebhookURL(appURL, token)}, nil
}

// lastCatalogSync is the newest gofood_catalog_syncs row; any failure is nil.
func (s *Service) lastCatalogSync(ctx context.Context) *lastSync {
	var l lastSync
	var created time.Time
	err := s.db.QueryRow(ctx, `SELECT created_at, status, item_count, error FROM pos.gofood_catalog_syncs ORDER BY created_at DESC LIMIT 1`).
		Scan(&created, &l.Status, &l.ItemCount, &l.Error)
	if err != nil {
		return nil
	}
	l.CreatedAt = httpx.JSTime(created)
	return &l
}

/* ── webhook events ───────────────────────────────────────────────────── */

// RecordEvent is recordGofoodEvent: store the event; "" when its event_id
// was already received (idempotency).
func (s *Service) RecordEvent(ctx context.Context, ev *domain.Event, idempotencyKey *string) (string, error) {
	payload, err := json.Marshal(ev)
	if err != nil {
		return "", err
	}
	var orderNumber *string
	if ev.Body.Order != nil {
		orderNumber = ev.Body.Order.OrderNumber
	}
	var id string
	err = s.db.QueryRow(ctx, `INSERT INTO pos.gofood_events (event_id, event_name, gofood_order_id, idempotency_key, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id::text`, ev.Header.EventID, ev.Header.EventName, orderNumber, idempotencyKey, payload).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (s *Service) finishEvent(ctx context.Context, rowID, result string, eventErr *string) error {
	_, err := s.db.Exec(ctx, `UPDATE pos.gofood_events SET result = $2, error = $3, processed_at = now() WHERE id = $1`, rowID, result, eventErr)
	return err
}

// ProcessEvent is processGofoodEvent: upsert the gofood_orders row, then
// auto-accept, sync an acceptance made in the GoBiz app, or cancel/complete
// the POS order. The result lands in gofood_events; a failure is stored as
// result=error and returned.
func (s *Service) ProcessEvent(ctx context.Context, cfg gobizapi.Config, ev *domain.Event, rowID string) (string, error) {
	order := ev.Body.Order
	if !strings.HasPrefix(ev.Header.EventName, "gofood.order.") || order == nil || order.OrderNumber == nil || *order.OrderNumber == "" {
		return "ignored_non_order", s.finishEvent(ctx, rowID, "ignored_non_order", nil)
	}
	result, err := s.applyOrderEvent(ctx, cfg, ev)
	if err == nil {
		err = s.finishEvent(ctx, rowID, result, nil)
	}
	if err != nil {
		msg := errorMessage(err)
		if ferr := s.finishEvent(ctx, rowID, "error", &msg); ferr != nil {
			return "", ferr
		}
		return "", err
	}
	return result, nil
}

func (s *Service) applyOrderEvent(ctx context.Context, cfg gobizapi.Config, ev *domain.Event) (string, error) {
	row, err := s.upsertOrder(ctx, ev)
	if err != nil {
		return "", err
	}
	result := "status:" + row.Status
	orders := s.p.Orders
	switch name := ev.Header.EventName; {
	case name == "gofood.order.awaiting_merchant_acceptance" && row.Status == "awaiting_acceptance":
		if !cfg.AutoAccept || !cfg.IsConfigured() {
			break
		}
		claimed, err := orders.ClaimAutoAccept(ctx, s.db, row.ID)
		if err != nil || !claimed {
			return result, err
		}
		err = s.api.Accept(ctx, cfg, row.GofoodOrderType, row.GofoodOrderID)
		if err == nil {
			err = orders.EnsurePosOrder(ctx, s.db, row.ID)
		}
		if err == nil {
			return "auto_accepted", nil
		}
		msg := errorMessage(err)
		if err := orders.ReleaseAutoAccept(ctx, s.db, row.ID, msg); err != nil {
			return "", err
		}
		result = "auto_accept_failed:" + msg
	case name == "gofood.order.merchant_accepted" && row.Status == "accepted":
		// Accepted elsewhere (the GoBiz app): make sure the POS order exists.
		if err := orders.EnsurePosOrder(ctx, s.db, row.ID); err != nil {
			return "", err
		}
		result = "accepted_synced"
	case name == "gofood.order.cancelled":
		if row.PosOrderID != nil {
			reason := "-"
			if row.CancelReason != nil && *row.CancelReason != "" {
				reason = *row.CancelReason
			}
			if err := orders.SetPosOrderStatus(ctx, s.db, *row.PosOrderID, "cancelled", "GoFood "+row.GofoodOrderID+" dibatalkan: "+reason); err != nil {
				return "", err
			}
		}
		result = "cancelled"
	case name == "gofood.order.completed":
		if row.PosOrderID != nil {
			if err := orders.SetPosOrderStatus(ctx, s.db, *row.PosOrderID, "completed", "GoFood "+row.GofoodOrderID+" selesai"); err != nil {
				return "", err
			}
		}
		result = "completed"
	}
	return result, nil
}

// upsertOrder is upsertGofoodOrderFromEvent. Items are mapped only when the
// event carries them and the stored row has none yet.
func (s *Service) upsertOrder(ctx context.Context, ev *domain.Event) (*OrderRow, error) {
	venue := s.p.Venues.DefaultVenue(ctx, s.db)
	summary := domain.Summarize(ev)
	next := domain.StatusFromEventName(ev.Header.EventName)
	existing, err := s.p.Orders.ByGofoodID(ctx, s.db, summary.GofoodOrderID)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(ev)
	if err != nil {
		return nil, err
	}
	w := OrderWrite{Summary: summary, RawPayload: raw, Venue: venue}
	if len(summary.Items) > 0 && (existing == nil || !existing.HasItems) {
		refs, err := s.productRefs(ctx, summary.Items)
		if err != nil {
			return nil, err
		}
		mapped := domain.MapItems(summary.Items, refs)
		if w.Items, err = json.Marshal(mapped.Lines); err != nil {
			return nil, err
		}
		if w.Unmapped, err = json.Marshal(mapped.Unmapped); err != nil {
			return nil, err
		}
	}

	if existing == nil {
		w.Status = next
		if w.Status == "" {
			w.Status = "created"
		}
		if w.Status == "awaiting_acceptance" {
			now := s.now()
			w.AwaitingSince = &now
		}
		if w.Items == nil {
			w.Items, w.Unmapped = []byte("[]"), []byte("[]")
		}
		return s.p.Orders.Insert(ctx, s.db, w)
	}
	w.Status = existing.Status
	if next != "" && domain.ShouldAdvanceStatus(existing.Status, next) {
		w.Status = next
	}
	return s.p.Orders.Update(ctx, s.db, existing.ID, w)
}

// productRefs is loadProductRefs: the POS products of the items, with
// add-on prices at the GoFood markup (as synced to the catalog).
func (s *Service) productRefs(ctx context.Context, items []domain.Item) (map[string]domain.ProductRef, error) {
	refs, err := s.p.Catalog.ProductRefs(ctx, s.db, domain.ProductIDs(items))
	if err != nil {
		return nil, err
	}
	rule, err := s.p.Catalog.ChannelRule(ctx, s.db, "gofood")
	if err != nil || rule == nil {
		return refs, err
	}
	for id, ref := range refs {
		mods := make([]domain.RefModifier, len(ref.Modifiers))
		for i, m := range ref.Modifiers {
			m.Price = domain.ApplyChannelMarkup(m.Price, *rule)
			mods[i] = m
		}
		ref.Modifiers = mods
		refs[id] = ref
	}
	return refs, nil
}

/* ── helpers ──────────────────────────────────────────────────────────── */

// errorMessage is `error instanceof Error ? error.message : String(error)`;
// a PostgreSQL error reads like node-postgres' message.
func errorMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	return err.Error()
}

// newUUID is crypto.randomUUID (version 4).
func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
