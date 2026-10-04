package posops

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
)

// newTableQr is generateTableQrCode: eight random hex characters, upper case.
func newTableQr(tableNumber string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return domain.TableQrCode(tableNumber, strings.ToUpper(hex.EncodeToString(b)))
}

var uniqueMessage = regexp.MustCompile(`(?i)unique|duplicate`)

// tableConflict maps a unique violation to the routes' 409.
func tableConflict(err error) error {
	if err != nil && uniqueMessage.MatchString(pgMessage(err)) {
		return fail(http.StatusConflict, "Table number or QR code already exists")
	}
	return err
}

// TableBoard mirrors GET /api/pos/tables: every table with its open bills.
// Checkouts are limited to the caller's company and branch unless unscoped.
func (s *Service) TableBoard(ctx context.Context, userID string, includeInactive bool) ([]domain.TableBoard, error) {
	tables, err := listTables(ctx, s.db, includeInactive)
	if err != nil {
		return nil, err
	}
	orders, err := s.ports.Sales.TableOpenOrders(ctx, s.db)
	if err != nil {
		return nil, err
	}
	sc, err := scope.Load(ctx, s.db, userID)
	if err != nil {
		return nil, err
	}
	var companyID, branchID *string
	if !sc.Unscoped {
		companyID, branchID = nonEmptyPtr(sc.CompanyID), nonEmptyPtr(sc.BranchID)
	}
	checkouts, err := s.ports.Sales.TableUnpaidCheckouts(ctx, s.db, companyID, branchID)
	if err != nil {
		switch database.PgCode(err) {
		case "42P01", "42703": // checkout table or column missing: no checkouts
			checkouts = nil
		default:
			return nil, err
		}
	}

	ordersByTable := map[string][]domain.BoardOrder{}
	for _, o := range orders {
		if o.TableID != nil && *o.TableID != "" {
			ordersByTable[*o.TableID] = append(ordersByTable[*o.TableID], o)
		}
	}
	checkoutsByTable := map[string][]domain.BoardCheckout{}
	for _, c := range checkouts {
		if c.TableID != nil && *c.TableID != "" {
			checkoutsByTable[*c.TableID] = append(checkoutsByTable[*c.TableID], c)
		}
	}
	out := make([]domain.TableBoard, len(tables))
	for i, t := range tables {
		out[i] = domain.NormalizeTableBoard(t, ordersByTable[t.ID], checkoutsByTable[t.ID])
	}
	return out, nil
}

func nonEmptyPtr(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

// CreateTable mirrors POST /api/pos/tables: a new table never starts
// occupied.
func (s *Service) CreateTable(ctx context.Context, body any) (domain.TableBoard, error) {
	p, msg := domain.ParseTablePayload(body, true, newTableQr)
	if msg != "" {
		return domain.TableBoard{}, fail(http.StatusBadRequest, msg)
	}
	status := p.Status
	if status == "occupied" {
		status = "available"
	}
	row, err := insertTable(ctx, s.db, p, status)
	if err != nil {
		return domain.TableBoard{}, tableConflict(err)
	}
	return domain.NormalizeTableBoard(row, nil, nil), nil
}

// UpdateTable mirrors PATCH /api/pos/tables/{id}.
func (s *Service) UpdateTable(ctx context.Context, id string, body any) (domain.TableMaster, error) {
	p, msg := domain.ParseTablePayload(body, true, newTableQr)
	if msg != "" {
		return domain.TableMaster{}, fail(http.StatusBadRequest, msg)
	}
	row, err := updateTable(ctx, s.db, id, p)
	if database.IsNoRows(err) {
		return domain.TableMaster{}, fail(http.StatusNotFound, "Table not found")
	}
	if err != nil {
		return domain.TableMaster{}, tableConflict(err)
	}
	return domain.NormalizeTableMaster(row), nil
}

// DeactivateTable mirrors DELETE /api/pos/tables/{id}: refused while an
// active order sits on the table, otherwise a soft delete.
func (s *Service) DeactivateTable(ctx context.Context, id string) error {
	busy, err := s.ports.Sales.TableHasActiveOrder(ctx, s.db, id, "")
	if err != nil {
		return err
	}
	if busy {
		return fail(http.StatusConflict, "Table still has an open bill — deactivate instead of deleting")
	}
	found, err := deactivateTable(ctx, s.db, id)
	if err != nil {
		return err
	}
	if !found {
		return fail(http.StatusNotFound, "Table not found")
	}
	return nil
}

// MoveTable mirrors PATCH /api/pos/tables/{id}/position.
func (s *Service) MoveTable(ctx context.Context, id string, body any) (*Obj, error) {
	x, y, msg := domain.ParsePosition(body)
	if msg != "" {
		return nil, fail(http.StatusBadRequest, msg)
	}
	row, err := moveTable(ctx, s.db, id, x, y)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fail(http.StatusNotFound, "Table not found")
	}
	return NewObj("id", row.Get("id"), "pos_x", domain.Number(row.Get("pos_x")), "pos_y", domain.Number(row.Get("pos_y"))), nil
}
