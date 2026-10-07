package shop

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Courier settings and rates (lib/shop/shipping/{index,settings}.ts). The
// provider (Biteship or RajaOngkir) comes from the active settings row.

// providerError is ShippingProviderError / MarketplaceError: an ApiError
// (502 by default) whose message reaches the client.
func providerError(msg string, status ...int) *httpx.Error {
	code := 502
	if len(status) > 0 {
		code = status[0]
	}
	return httpx.Status(code, msg)
}

// requireEnvKey is requireEnvKey: 503 when the credential is not set.
func (s *Service) requireEnvKey(name string) (string, error) {
	if v := s.ports.Getenv(name); v != "" {
		return v, nil
	}
	return "", providerError(name+" belum dikonfigurasi di environment server", 503)
}

// shippingSettings reads the active settings row, creating it the first
// time (getOrCreateShippingSettings).
func (s *Service) shippingSettings(ctx context.Context) (*Row, error) {
	existing, err := queryRow(ctx, s.db, `SELECT * FROM shop.shipping_settings WHERE is_active = true LIMIT 1`)
	if err != nil || existing != nil {
		return existing, err
	}
	created, err := queryRow(ctx, s.db, `INSERT INTO shop.shipping_settings (provider, couriers) VALUES ('biteship', $1) RETURNING *`, domain.DefaultCouriers)
	if err != nil {
		// The TS rethrows the client error as a plain Error: a 500.
		return nil, errors.New(err.Error())
	}
	return created, nil
}

// ShippingSettings is GET /api/shop/shipping/settings.
func (s *Service) ShippingSettings(ctx context.Context) (*Row, error) { return s.shippingSettings(ctx) }

// UpdateShippingSettings is updateShippingSettings.
func (s *Service) UpdateShippingSettings(ctx context.Context, fields []domain.PatchField, userID string) (*Row, error) {
	settings, err := s.shippingSettings(ctx)
	if err != nil {
		return nil, err
	}
	var sets []string
	var args []any
	for _, f := range fields {
		args = append(args, f.Value)
		sets = append(sets, fmt.Sprintf("%s = $%d", f.Column, len(args)))
	}
	args = append(args, userID, s.now(), settings.Str("id"))
	n := len(args)
	return queryRow(ctx, s.db, fmt.Sprintf(`UPDATE shop.shipping_settings SET %s, updated_by = $%d, updated_at = $%d
		WHERE id = $%d RETURNING *`, strings.Join(sets, ", "), n-2, n-1, n), args...)
}

// shippingContext is loadShippingContext.
type shippingContext struct {
	settings *Row
	provider shippingProvider
	originID string
	markup   float64
}

func (s *Service) loadShippingContext(ctx context.Context) (*shippingContext, error) {
	settings, err := s.shippingSettings(ctx)
	if err != nil {
		return nil, err
	}
	// resolveOriginId: the area id for Biteship, the district id for RajaOngkir.
	provider := settings.Str("provider")
	origin := settings.Str("origin_area_id")
	if provider == "rajaongkir" {
		origin = settings.Str("origin_district_id")
	}
	return &shippingContext{
		settings: settings,
		provider: s.resolveProvider(provider),
		originID: origin,
		markup:   domain.OrFinite(domain.JSNumber(settings.Str("markup_amount"))),
	}, nil
}

// quoteFromOrigin is quoteFromOrigin: rates from the shop origin with the
// couriers enabled in settings.
func (s *Service) quoteFromOrigin(ctx context.Context, sc *shippingContext, destID string, destPostal *string, weightGram, itemValue float64) ([]domain.RateQuote, error) {
	var originPostal *string
	if v, ok := sc.settings.Get("origin_postal_code").(string); ok {
		originPostal = &v
	}
	return sc.provider.getRates(ctx, rateRequest{
		originID: sc.originID, originPostalCode: originPostal,
		destinationID: destID, destinationPostalCode: destPostal,
		weightGram: weightGram, itemValue: itemValue,
		couriers: domain.ParseCourierList(sc.settings.Str("couriers")),
	})
}

// AreaSuggestion is AreaSuggestion.
type AreaSuggestion struct {
	Provider   string  `json:"provider"`
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	PostalCode *string `json:"postalCode"`
}

// TrackingEvent is TrackingEvent.
type TrackingEvent struct {
	Time   *string `json:"time"`
	Status string  `json:"status"`
	Note   *string `json:"note"`
}

// TrackingResult is TrackingResult.
type TrackingResult struct {
	Provider    string          `json:"provider"`
	Waybill     string          `json:"waybill"`
	CourierCode string          `json:"courierCode"`
	Status      string          `json:"status"`
	Events      []TrackingEvent `json:"events"`
}

type rateRequest struct {
	originID              string
	originPostalCode      *string
	destinationID         string
	destinationPostalCode *string
	weightGram            float64
	itemValue             float64
	couriers              []string
}

type shipmentItem struct {
	name       string
	value      float64
	weightGram float64
	quantity   float64
}

type createShipmentRequest struct {
	originID, originContactName, originContactPhone, originAddress string
	destAreaID, destContactName, destContactPhone, destAddress     string
	courierCode, serviceCode, referenceID                          string
	items                                                          []shipmentItem
}

type createdShipment struct {
	providerOrderID string
	waybill         *string
	price           float64
}

// shippingProvider is ShippingProvider.
type shippingProvider interface {
	name() string
	canCreateShipment() bool
	searchAreas(ctx context.Context, query string) ([]AreaSuggestion, error)
	getRates(ctx context.Context, req rateRequest) ([]domain.RateQuote, error)
	getTracking(ctx context.Context, waybill, courier string) (*TrackingResult, error)
	createShipment(ctx context.Context, req createShipmentRequest) (*createdShipment, error)
}

// resolveProvider is resolveShippingProvider: biteship unless rajaongkir.
func (s *Service) resolveProvider(name string) shippingProvider {
	if strings.ToLower(name) == "rajaongkir" {
		return rajaongkir{s}
	}
	return biteship{s}
}

// SearchAreas is the areas routes: the active provider's destinations.
func (s *Service) SearchAreas(ctx context.Context, query string) ([]AreaSuggestion, string, error) {
	sc, err := s.loadShippingContext(ctx)
	if err != nil {
		return nil, "", err
	}
	areas, err := sc.provider.searchAreas(ctx, query)
	return areas, sc.provider.name(), err
}

// Track is GET /api/shop/shipping/track.
func (s *Service) Track(ctx context.Context, waybill, courier string) (*TrackingResult, error) {
	sc, err := s.loadShippingContext(ctx)
	if err != nil {
		return nil, err
	}
	return sc.provider.getTracking(ctx, waybill, courier)
}
