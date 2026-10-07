package gofood

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/gofood/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/gobiz"
)

// ConfigSource loads the GoBiz settings (loadGobizConfig). Settings belong
// to no wave yet; SettingsSQL is the stopgap.
type ConfigSource interface {
	LoadConfig(ctx context.Context, q database.Querier) (gobiz.Config, error)
}

// Venue is the CRM default company/branch stamped on POS orders.
type Venue struct{ CompanyID, BranchID *string }

// Venues reads the CRM default venue (getCrmDefaultVenue, owned by crm);
// it never fails. CrmVenueSQL is the stopgap.
type Venues interface {
	DefaultVenue(ctx context.Context, q database.Querier) Venue
}

// Ports are the reads this package needs from other contexts.
type Ports struct {
	Config ConfigSource
	Venues Venues
}

// ErrNotConfigured is GobizNotConfiguredError.
var ErrNotConfigured = errors.New("GoBiz belum dikonfigurasi — isi Client ID, Client Secret, dan Outlet ID di Settings → Integrasi")

// queryBuilderError marks a failure the TS raised through the pg query
// shim, whose error objects are not `Error` instances: the route answers
// them with its "Aksi gagal" fallback.
type queryBuilderError struct{ err error }

func (e queryBuilderError) Error() string { return e.err.Error() }
func (e queryBuilderError) Unwrap() error { return e.err }

// fallbackCashierID is FALLBACK_CASHIER_ID: GoFood orders have no cashier.
const fallbackCashierID = "00000000-0000-0000-0000-000000000001"

// Service is the cashier side of lib/gobiz/service.ts.
type Service struct {
	db    database.DB
	ports Ports
	api   *gobiz.Client
	now   func() time.Time
	log   *slog.Logger
}

// NewService builds the service; nil now/log take time.Now and slog.Default.
func NewService(db database.DB, ports Ports, api *gobiz.Client, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, api: api, now: now, log: log}
}

// Config is loadGobizConfig.
func (s *Service) Config(ctx context.Context) (gobiz.Config, error) {
	return s.ports.Config.LoadConfig(ctx, s.db)
}

func (s *Service) requireConfig(ctx context.Context) (gobiz.Config, error) {
	cfg, err := s.Config(ctx)
	if err != nil {
		return cfg, err
	}
	if !cfg.IsConfigured() {
		return cfg, ErrNotConfigured
	}
	return cfg, nil
}

// List is listGofoodOrders; limitRaw is the raw ?limit value.
func (s *Service) List(ctx context.Context, status, limitRaw string) ([]*jsrow.Row, error) {
	return listOrders(ctx, s.db, status, domain.ListLimit(limitRaw))
}

// Get is getGofoodOrder (nil when missing).
func (s *Service) Get(ctx context.Context, id string) (*jsrow.Row, error) {
	return orderBy(ctx, s.db, "g.id", id)
}

// loadForAction is requireConfig + getGofoodOrder with the TS "not found".
func (s *Service) loadForAction(ctx context.Context, id string) (gobiz.Config, *jsrow.Row, error) {
	cfg, err := s.requireConfig(ctx)
	if err != nil {
		return cfg, nil, err
	}
	row, err := s.Get(ctx, id)
	if err == nil && row == nil {
		err = errors.New("Order GoFood tidak ditemukan")
	}
	return cfg, row, err
}

// Accept is acceptGofoodOrderById: accept at GoBiz, mark accepted, create
// the POS order. The returned row is read before the POS order exists, with
// pos_order_id overwritten, as the TS spread does.
func (s *Service) Accept(ctx context.Context, id string) (*jsrow.Row, error) {
	cfg, row, err := s.loadForAction(ctx, id)
	if err != nil {
		return nil, err
	}
	if status := row.Str("status"); !domain.CanAccept(status) {
		return nil, fmt.Errorf("Order sudah berstatus %s", status)
	}
	if err := s.api.Accept(ctx, cfg, row.Str("gofood_order_type"), row.Str("gofood_order_id")); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `UPDATE pos.gofood_orders SET status = 'accepted', accepted_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`, id); err != nil {
		return nil, err
	}
	fresh, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if fresh == nil {
		return nil, errors.New("Order GoFood tidak ditemukan")
	}
	posOrderID, err := s.EnsurePosOrder(ctx, fresh)
	if err != nil {
		return nil, err
	}
	return fresh.Clone().Set("pos_order_id", posOrderID), nil
}

// Reject is rejectGofoodOrderById; description is already trimmed.
func (s *Service) Reject(ctx context.Context, id, code, description string) (*jsrow.Row, error) {
	cfg, row, err := s.loadForAction(ctx, id)
	if err != nil {
		return nil, err
	}
	if status := row.Str("status"); !domain.CanReject(status) {
		return nil, fmt.Errorf("Order sudah berstatus %s", status)
	}
	if err := s.api.Reject(ctx, cfg, row.Str("gofood_order_type"), row.Str("gofood_order_id"), code, description); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `UPDATE pos.gofood_orders SET status = 'rejected', rejected_at = now(), cancel_reason = $2, last_error = NULL, updated_at = now() WHERE id = $1`,
		id, code+": "+description); err != nil {
		return nil, err
	}
	if posOrderID := row.StrPtr("pos_order_id"); posOrderID != nil {
		if err := SetPosOrderStatus(ctx, s.db, *posOrderID, "cancelled", "GoFood "+row.Str("gofood_order_id")+" ditolak: "+description, s.now()); err != nil {
			return nil, err
		}
	}
	return s.Get(ctx, id)
}

// Ready is markGofoodOrderReadyById; an order already marked is returned as is.
func (s *Service) Ready(ctx context.Context, id string) (*jsrow.Row, error) {
	cfg, row, err := s.loadForAction(ctx, id)
	if err != nil {
		return nil, err
	}
	if row.Get("food_ready_at") != nil {
		return row, nil
	}
	if err := s.api.FoodReady(ctx, cfg, row.Str("gofood_order_type"), row.Str("gofood_order_id")); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `UPDATE pos.gofood_orders SET food_ready_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`, id); err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

// NotifyFoodReadyForPosOrder is notifyGofoodFoodReadyForPosOrder, the KDS
// hook of PATCH /api/pos/orders/{id}/status: tell GoFood the food is ready.
// Best effort: a failure lands in gofood_orders.last_error, never returned.
func (s *Service) NotifyFoodReadyForPosOrder(ctx context.Context, posOrderID string) {
	row, err := orderBy(ctx, s.db, "g.pos_order_id", posOrderID)
	if err == nil {
		if row == nil || row.Get("food_ready_at") != nil || !domain.NotifiesFoodReady(row.Str("status")) {
			return
		}
		_, err = s.Ready(ctx, row.Str("id"))
	}
	if err == nil {
		return
	}
	message := errorMessage(err)
	var apiErr *gobiz.APIError
	if errors.As(err, &apiErr) {
		message = fmt.Sprintf("%d %s", apiErr.Status, apiErr.Message)
	}
	s.log.Error("[gobiz] food-prepared gagal", "pos_order", posOrderID, "error", message)
	_, _ = s.db.Exec(ctx, `UPDATE pos.gofood_orders SET last_error = $2, updated_at = now() WHERE pos_order_id = $1`, posOrderID, message)
}

// CreatePosOrder is the create_pos_order action: (re)create the POS order
// of a GoFood order whose items were mapped late. nil when the order is
// missing.
func (s *Service) CreatePosOrder(ctx context.Context, id string) (*jsrow.Row, error) {
	row, err := s.Get(ctx, id)
	if err != nil || row == nil {
		return nil, err
	}
	posOrderID, err := s.EnsurePosOrder(ctx, row)
	if err != nil {
		return nil, err
	}
	if row, err = s.Get(ctx, id); err != nil {
		return nil, err
	}
	if row == nil {
		row = jsrow.New()
	}
	return row.Clone().Set("pos_order_id", posOrderID), nil
}

// mappedLine is MappedGofoodLine as stored in gofood_orders.items.
type mappedLine struct {
	ProductID   *string         `json:"product_id"`
	ProductName string          `json:"product_name"`
	ProductSKU  *string         `json:"product_sku"`
	Quantity    float64         `json:"quantity"`
	UnitPrice   float64         `json:"unit_price"`
	VariantName *string         `json:"variant_name"`
	Modifiers   json.RawMessage `json:"modifiers"`
	Notes       *string         `json:"notes"`
	Station     *string         `json:"station"`
}

// EnsurePosOrder is ensurePosOrderForGofood: create the paid delivery
// pos_orders row (+ items + history) for an accepted GoFood order and link
// it. Idempotent; nil when no item could be mapped (the cashier handles the
// order by hand). The TS writes these one by one; here they share a
// transaction that locks the GoFood row, so a double click cannot create
// two POS orders.
func (s *Service) EnsurePosOrder(ctx context.Context, row *jsrow.Row) (*string, error) {
	if id := row.StrPtr("pos_order_id"); id != nil {
		return id, nil
	}
	var lines []mappedLine
	if err := json.Unmarshal(rawJSON(row.Get("items")), &lines); err != nil {
		return nil, err
	}
	if len(lines) == 0 {
		return nil, nil
	}
	var unmapped []json.RawMessage
	_ = json.Unmarshal(rawJSON(row.Get("unmapped_items")), &unmapped)
	venue := s.ports.Venues.DefaultVenue(ctx, s.db)

	var orderID *string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT pos_order_id::text FROM pos.gofood_orders WHERE id = $1 FOR UPDATE`, row.Str("id")).Scan(&orderID)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		if orderID != nil {
			return nil
		}
		id, err := insertPosOrder(ctx, tx, row, lines, len(unmapped), venue, s.now())
		if err != nil {
			return err
		}
		orderID = &id
		_, err = tx.Exec(ctx, `UPDATE pos.gofood_orders SET pos_order_id = $2, updated_at = now() WHERE id = $1`, row.Str("id"), id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return orderID, nil
}

// rawJSON returns a json/jsonb column ("[]" when NULL).
func rawJSON(v any) []byte {
	if raw, ok := v.(json.RawMessage); ok {
		return raw
	}
	return []byte("[]")
}
