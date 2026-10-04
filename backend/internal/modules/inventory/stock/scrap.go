package stock

import (
	"crypto/rand"
	"math"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

/* GET /api/inventory/scrap — latest scrap / write-off movements. */
func (h *handler) scrapHistory(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	limit := math.Min(200, math.Max(1, orNum(kit.JSNumber(sp.Get("limit")), 50)))
	page := math.Max(1, orNum(kit.JSNumber(sp.Get("page")), 1))
	rows, total, err := h.listMovements(r, movementFilter{scope: scope, referenceType: "scrap"}, limit, (page-1)*limit)
	if err != nil {
		return err
	}
	type meta struct {
		Page  kit.Float `json:"page"`
		Limit kit.Float `json:"limit"`
		Total int       `json:"total"`
	}
	return kit.OK(w, struct {
		Success bool     `json:"success"`
		Data    kit.Rows `json:"data"`
		Meta    meta     `json:"meta"`
	}{true, rows, meta{kit.Float(page), kit.Float(limit), total}})
}

// orNum is `n || def` for a JS number (0 and NaN are falsy).
func orNum(n, def float64) float64 {
	if n == 0 || math.IsNaN(n) {
		return def
	}
	return n
}

func uuidMsg(msg string) validate.StrOpts {
	return validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", msg, validate.IsUUID(s)
	}}
}

func scrapReasonValues() []string {
	out := make([]string, len(domain.ScrapReasons))
	for i, r := range domain.ScrapReasons {
		out[i] = r.Value
	}
	return out
}

type scrapResult struct {
	ReferenceID     string  `json:"reference_id"`
	ReferenceNumber string  `json:"reference_number"`
	Qty             float64 `json:"qty"`
	QtyBefore       float64 `json:"qty_before"`
	QtyAfter        float64 `json:"qty_after"`
	UnitCost        float64 `json:"unit_cost"`
	Value           float64 `json:"value"`
	AccountingNote  *string `json:"accounting_note"`
}

/*
POST /api/inventory/scrap — write off stock at one warehouse (optionally a

	chosen batch, which the batch trigger consumes first).
*/
func (h *handler) scrap(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	rawMaterialID := f.Str("raw_material_id", validate.Rule{}, uuidMsg("Bahan baku wajib dipilih"))
	warehouseID := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Gudang wajib dipilih"))
	qtyIn := kit.NumCheck(f, "qty", validate.Rule{}, kit.Positive("Qty scrap harus lebih dari 0"))
	reason := kit.Enum(f, "reason", validate.Rule{}, scrapReasonValues(), "")
	notes := f.Str("notes", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Max: 500})
	batchID := f.UUID("batch_id", validate.Rule{Optional: true, Nullable: true})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	if _, werr, err := kit.ValidateWarehouse(ctx, h.env.DB, *warehouseID, scope, nil); err != nil {
		return err
	} else if werr != "" {
		return httpx.BadRequest("Gudang tidak valid atau di luar cabang Anda")
	}

	now := h.env.Now()
	referenceID := kit.NewUUID()
	referenceNumber := scrapNumber(now)
	qty := kit.RoundQty(*qtyIn)
	reasonLabel := domain.ScrapReasonLabel(*reason)
	var trimmedNotes *string
	if notes != nil {
		if t := validate.JSTrim(*notes); t != "" {
			trimmedNotes = &t
		}
	}
	var batch *string
	if batchID != nil && *batchID != "" {
		batch = batchID
	}

	var qtyBefore, qtyAfter, unitCost float64
	var branchID *string
	err = h.env.Tx(ctx, func(q database.Querier) error {
		inv, err := kit.QueryOne(ctx, q, `SELECT id::text, qty_available::text, unit_cost::text, branch_id::text
			FROM inventory.inventory WHERE raw_material_id = $1 AND warehouse_id = $2 AND is_active = true FOR UPDATE`,
			*rawMaterialID, *warehouseID)
		if err != nil {
			return err
		}
		if inv == nil {
			return httpx.NotFound("Bahan baku tidak punya stok di gudang ini")
		}
		var batchRemaining *float64
		var batchLabel *kit.Row
		if batch != nil {
			b, err := kit.QueryOne(ctx, q, `SELECT qty_remaining::text, batch_number, expiry_date::text
				FROM inventory.stock_batches WHERE id = $1 AND inventory_id = $2`, *batch, inv.Str("id"))
			if err != nil {
				return err
			}
			if b == nil {
				return httpx.NotFound("Batch tidak ditemukan di gudang ini")
			}
			batchRemaining = kit.Ptr(b.Num("qty_remaining"))
			batchLabel = kit.Obj("batch_number", b.Get("batch_number"), "expiry_date", b.Get("expiry_date"))
		}
		qtyBefore = inv.Num("qty_available")
		if msg := domain.EvaluateScrap(qty, qtyBefore, batchRemaining); msg != "" {
			return httpx.Conflict(msg)
		}
		qtyAfter = kit.RoundQty(qtyBefore - qty)
		unitCost = inv.Num("unit_cost")
		branchID = inv.StrPtr("branch_id")
		if _, err := q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, last_movement_at = now(),
			updated_at = now(), updated_by = $2 WHERE id = $3`, kit.N(qtyAfter), u.ID, inv.Str("id")); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `INSERT INTO inventory.inventory_movements (
			inventory_id, raw_material_id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost, branch_id, warehouse_id,
			reference_type, reference_id, reference_number, alasan, catatan, batch_id, created_by, updated_by)
			VALUES ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, 'scrap', $10, $11, $12, $13, $14, $15, $15)`,
			inv.Str("id"), *rawMaterialID, kit.N(qty), kit.N(qtyBefore), kit.N(qtyAfter), kit.N(unitCost), kit.N(qty*unitCost),
			branchID, *warehouseID, referenceID, referenceNumber, "Scrap: "+reasonLabel, trimmedNotes, batch, u.ID); err != nil {
			return err
		}
		var batchBefore any
		if batchLabel != nil {
			batchBefore = batchLabel.Set("qty_remaining", *batchRemaining)
		}
		auditReason := reasonLabel
		if trimmedNotes != nil {
			auditReason += ": " + *trimmedNotes
		}
		return audit.Write(ctx, q, audit.Entry{
			ActorID: u.ID, ActorName: &u.FullName, Action: "stock.scrap", Entity: "inventory",
			EntityID: kit.Ptr(inv.Str("id")), EntityLabel: &referenceNumber,
			Before: kit.Obj("qty_available", qtyBefore, "batch", batchBefore),
			After:  kit.Obj("qty_available", qtyAfter, "qty_scrapped", qty, "value", qty*unitCost, "reason", *reason),
			Reason: &auditReason,
		}.WithRequest(r))
	})
	if err != nil {
		return err
	}

	company, err := companyOfBranch(ctx, h.env.DB, branchID)
	if err != nil {
		return err
	}
	journalNotes := "Scrap " + referenceNumber + " (" + reasonLabel + ")"
	if trimmedNotes != nil {
		journalNotes += ": " + *trimmedNotes
	}
	note, err := h.ports.Journals.PostStockAdjustment(ctx, h.env.DB, AdjustmentJournal{
		CompanyID: company, UserID: u.ID, DocumentID: referenceID, EntryDate: kit.UTCDate(now),
		RawMaterialID: *rawMaterialID, QtyDiff: -qty, UnitCost: unitCost, Notes: &journalNotes,
	})
	if err != nil {
		return err
	}
	result := scrapResult{
		ReferenceID: referenceID, ReferenceNumber: referenceNumber, Qty: qty, QtyBefore: qtyBefore, QtyAfter: qtyAfter,
		UnitCost: unitCost, Value: kit.JSRound(qty*unitCost*100) / 100, AccountingNote: note,
	}
	message := "Scrap " + referenceNumber + " tercatat, stok berkurang " + kit.JSNum(qty)
	if note != nil && *note != "" {
		message += " (" + *note + ")"
	}
	return httpx.JSON(w, http.StatusCreated, struct {
		Success bool        `json:"success"`
		Data    scrapResult `json:"data"`
		Message string      `json:"message"`
	}{true, result, message})
}

// scrapNumber is SCR-<UTC yyyyMMddHHmmss>-<4 base36 chars>.
func scrapNumber(now time.Time) string {
	return "SCR-" + now.UTC().Format("20060102150405") + "-" + randomBase36(4)
}

const base36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

func randomBase36(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	var sb strings.Builder
	for _, c := range b {
		sb.WriteByte(base36[int(c)%36])
	}
	return sb.String()
}
