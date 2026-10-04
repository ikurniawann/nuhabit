// Package giftcards is the gift card part of the stored-value context:
// issue, reload, adjust, link and the POS check (lib/giftcard,
// lib/promo/gift-cards-server.ts), plus the checkout-facing methods POS
// sales calls inside its own transaction.
package giftcards

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/giftcards/domain"
	"nuhabit/backend/internal/platform/database"
)

// Settings reads and writes configuration.app_settings
// (lib/settings/app-settings getSetting / setSetting).
type Settings interface {
	// Get is nil when the key has no row or a NULL value.
	Get(ctx context.Context, q database.Querier, key string) (*string, error)
	Set(ctx context.Context, q database.Querier, key, value string) error
}

// Catalog reads the POS catalog (pos.pos_products).
type Catalog interface {
	// GiftCardProductIDs returns the ids among ids whose product_kind is
	// 'gift_card'.
	GiftCardProductIDs(ctx context.Context, q database.Querier, ids []string) ([]string, error)
}

// Ports are the gift card adapters internal/app wires.
type Ports struct {
	Settings Settings
	Catalog  Catalog
}

// Service is the gift card service.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

// NewService builds the gift card service.
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	return &Service{db: db, ports: ports, now: now, log: log}
}

// Scope is GiftCardScope: the venue a card belongs to.
type Scope struct {
	CompanyID string
	BranchID  string
}

// atomic is withTransaction: fn runs in a transaction nested in q (a
// savepoint when q is the caller's transaction), so a failure inside fn
// undoes only fn's writes and leaves the caller's transaction usable.
func atomic(ctx context.Context, q database.Querier, fn func(database.Querier) error) error {
	if b, ok := q.(database.TxBeginner); ok {
		return database.WithTx(ctx, b, func(tx pgx.Tx) error { return fn(tx) })
	}
	return fn(q)
}

/* ── configuration (preset nominals and expiry) ──────────────────────── */

// ConfigKey is GIFT_CARD_CONFIG_KEY.
const ConfigKey = "giftcard_config"

// LoadConfig is loadGiftCardConfig: a broken app_settings value falls back
// to the defaults so a bad edit never stops the till.
func (s *Service) LoadConfig(ctx context.Context, q database.Querier) (domain.Config, error) {
	raw, err := s.ports.Settings.Get(ctx, q, ConfigKey)
	if err != nil {
		return domain.Config{}, err
	}
	var v any
	if raw != nil && *raw != "" {
		if json.Unmarshal([]byte(*raw), &v) != nil {
			v = nil
		}
	}
	return domain.ParseConfig(v), nil
}

// ConfigPatch is the PUT body: nil fields keep the stored value.
type ConfigPatch struct {
	Presets     []float64
	AllowCustom *bool
	// SetExpiry is true when expiry_months was sent (ExpiryMonths nil = null).
	SetExpiry    bool
	ExpiryMonths *int
}

// SaveConfig is saveGiftCardConfig: the stored config with patch applied,
// normalized, written back as JSON.
func (s *Service) SaveConfig(ctx context.Context, patch ConfigPatch) (domain.Config, error) {
	cfg, err := s.LoadConfig(ctx, s.db)
	if err != nil {
		return cfg, err
	}
	if patch.Presets != nil {
		cfg.Presets = patch.Presets
	}
	if patch.AllowCustom != nil {
		cfg.AllowCustom = *patch.AllowCustom
	}
	if patch.SetExpiry {
		cfg.ExpiryMonths = patch.ExpiryMonths
	}
	cfg = cfg.Normalized()
	raw, err := json.Marshal(cfg)
	if err != nil {
		return cfg, err
	}
	return cfg, s.ports.Settings.Set(ctx, s.db, ConfigKey, string(raw))
}
