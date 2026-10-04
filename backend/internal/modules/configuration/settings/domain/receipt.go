package domain

import "errors"

// Receipt limits (lib/pos/receipt-settings.ts): 80mm paper holds about 42
// monospace columns, and each section keeps at most 6 lines.
const (
	ReceiptLineMaxChars = 42
	ReceiptMaxLines     = 6
	// ReceiptGlobalID is RECEIPT_SETTINGS_GLOBAL_ID: the global row keeps a
	// fixed id so the migration seed and upserts converge.
	ReceiptGlobalID = "b0000000-0000-4000-8000-000000000040"
)

// ReceiptLines is normalizeReceiptLines: strings only, trimmed, no empty
// lines, capped in count and in UTF-16 length. Never nil.
func ReceiptLines(raw any) []string {
	out := []string{}
	list, _ := raw.([]any)
	for _, v := range list {
		s, ok := v.(string)
		if !ok {
			continue
		}
		if s = TrimJS(s); s == "" {
			continue
		}
		if len(out) == ReceiptMaxLines {
			break
		}
		out = append(out, SliceJS(s, ReceiptLineMaxChars))
	}
	return out
}

// ReceiptRow is an active pos.pos_receipt_settings row as stored, with the
// JSON line columns decoded.
type ReceiptRow struct {
	ID, BranchID, WarehouseID *string
	HeaderLines, FooterLines  any
	ShowStallName             bool
}

// ReceiptSettings is PosReceiptSettings as normalizeReceiptSettings renders
// a database row. updated_at reaches it as a Date, which is not a string, so
// it is always null.
type ReceiptSettings struct {
	ID            *string  `json:"id"`
	BranchID      *string  `json:"branch_id"`
	WarehouseID   *string  `json:"warehouse_id"`
	HeaderLines   []string `json:"header_lines"`
	FooterLines   []string `json:"footer_lines"`
	ShowStallName bool     `json:"show_stall_name"`
	UpdatedAt     *string  `json:"updated_at"`
}

// NormalizeReceipt is normalizeReceiptSettings of a database row.
func NormalizeReceipt(r ReceiptRow) ReceiptSettings {
	return ReceiptSettings{
		ID: r.ID, BranchID: r.BranchID, WarehouseID: r.WarehouseID,
		HeaderLines: ReceiptLines(r.HeaderLines), FooterLines: ReceiptLines(r.FooterLines),
		ShowStallName: r.ShowStallName,
	}
}

// ReceiptScope is ReceiptScopeInput.
type ReceiptScope struct {
	WarehouseID, BranchID    *string
	HeaderLines, FooterLines []string
	ShowStallName            bool
}

// ErrWarehouseNeedsBranch is parseReceiptScopeInput's 400.
var ErrWarehouseNeedsBranch = errors.New("Scope warehouse membutuhkan branch_id")

// ParseReceiptScope is parseReceiptScopeInput over a request body object.
func ParseReceiptScope(body map[string]any) (ReceiptScope, error) {
	text := func(key string) *string {
		if s, ok := body[key].(string); ok && s != "" {
			return &s
		}
		return nil
	}
	in := ReceiptScope{
		WarehouseID:   text("warehouse_id"),
		BranchID:      text("branch_id"),
		HeaderLines:   ReceiptLines(body["header_lines"]),
		FooterLines:   ReceiptLines(body["footer_lines"]),
		ShowStallName: body["show_stall_name"] != false,
	}
	if in.WarehouseID != nil && in.BranchID == nil {
		return in, ErrWarehouseNeedsBranch
	}
	return in, nil
}

// IsGlobal reports a scope without warehouse and branch.
func (s ReceiptScope) IsGlobal() bool { return s.WarehouseID == nil && s.BranchID == nil }

func same(a, b *string) bool { return a != nil && b != nil && *a == *b }

// FindReceiptScopeRow is findReceiptScopeRow: the active row of exactly
// this scope (warehouse, branch without warehouse, or global), or nil.
func FindReceiptScopeRow(rows []ReceiptRow, s ReceiptScope) *ReceiptRow {
	for i, r := range rows {
		var match bool
		switch {
		case s.WarehouseID != nil:
			match = same(r.WarehouseID, s.WarehouseID)
		case s.BranchID != nil:
			match = same(r.BranchID, s.BranchID) && r.WarehouseID == nil
		default:
			match = r.BranchID == nil && r.WarehouseID == nil
		}
		if match {
			return &rows[i]
		}
	}
	return nil
}
