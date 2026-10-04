package stock

import (
	"context"
	"errors"
	"math"
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Shared by the raw material and product opname routes
// (frontend/src/lib/inventory/opname-sessions.ts, opname-rules.ts).

// opnameListQuery is opnameListQuerySchema, parsed with no ignored values.
type opnameListQuery struct {
	page, limit                         float64
	status, warehouseID, search, reason string
}

func parseOpnameListQuery(r *http.Request) (opnameListQuery, error) {
	f := kit.FromRequest(r)
	page := f.Coerce("page", kit.Ptr(1.0), validate.NumOpts{Min: validate.Bound(1)})
	limit := f.Coerce("limit", kit.Ptr(20.0), validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(100)})
	status := f.Str("status", validate.Rule{Optional: true}, validate.StrOpts{})
	warehouse := f.UUID("warehouse_id", validate.Rule{Optional: true})
	search := f.Str("search", validate.Rule{Optional: true}, validate.StrOpts{})
	reason := f.Enum("reason", validate.Rule{Optional: true}, []string{"stock_opname", "manual_adjustment"})
	if err := f.FlattenErr("Validasi gagal"); err != nil {
		return opnameListQuery{}, err
	}
	return opnameListQuery{*page, *limit, kit.Deref(status), kit.Deref(warehouse), kit.Deref(search), kit.Deref(reason)}, nil
}

type opnamePagination struct {
	Page       kit.Float `json:"page"`
	Limit      kit.Float `json:"limit"`
	Total      int       `json:"total"`
	TotalPages kit.Float `json:"total_pages"`
}

func listPagination(page, limit float64, total int) opnamePagination {
	return opnamePagination{kit.Float(page), kit.Float(limit), total, kit.Float(math.Max(1, math.Ceil(float64(total)/limit)))}
}

type opnameCreate struct {
	warehouseID string
	opnameDate  *string
	notes       *string
	reason      string
}

func parseOpnameCreate(r *http.Request, warehouseMessage string) (opnameCreate, error) {
	f := validate.New(validate.ReadBody(r))
	warehouse := f.Str("warehouse_id", validate.Rule{}, uuidMsg(warehouseMessage))
	date := f.Str("opname_date", validate.Rule{Optional: true}, validate.StrOpts{})
	notes := f.Str("notes", validate.Rule{Optional: true}, validate.StrOpts{})
	reason := kit.Enum(f, "reason", validate.Rule{HasDefault: true}, []string{"stock_opname", "manual_adjustment"}, "")
	if err := f.Err("Validation failed"); err != nil {
		return opnameCreate{}, err
	}
	in := opnameCreate{warehouseID: *warehouse, opnameDate: date, notes: notes, reason: "stock_opname"}
	if reason != nil {
		in.reason = *reason
	}
	return in, nil
}

type opnamePatchLine struct {
	id         string
	qtyCounted *float64
	notes      *string
}

type opnamePatch struct {
	notes     *string
	cancelled bool
	lines     []opnamePatchLine
}

func parseOpnamePatch(r *http.Request) (opnamePatch, error) {
	f := validate.New(validate.ReadBody(r))
	var in opnamePatch
	in.notes = f.Str("notes", validate.Rule{Optional: true}, validate.StrOpts{})
	status := kit.Enum(f, "status", validate.Rule{Optional: true}, []string{"cancelled"}, "")
	in.cancelled = status != nil && *status == "cancelled"
	f.List("lines", validate.Rule{Optional: true}, math.MaxInt, func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		line := opnamePatchLine{}
		if id := item.UUID("id", validate.Rule{}); id != nil {
			line.id = *id
		}
		line.qtyCounted = item.Num("qty_counted", validate.Rule{Nullable: true}, validate.NumOpts{Min: validate.Bound(0)})
		line.notes = item.Str("notes", validate.Rule{Optional: true}, validate.StrOpts{})
		in.lines = append(in.lines, line)
	})
	return in, f.Err("Validation failed")
}

// opnameState is the part of a loaded opname applyOpnameChanges reads.
type opnameState struct {
	status string
	notes  *string
	lines  []opnameLineState
}

type opnameLineState struct {
	id                 string
	qtySystem          float64
	notes              *string
	qtyCounted, varian *float64
}

// applyOpnameChanges cancels the opname or saves counted quantities and
// re-summarizes the header; it reports whether it cancelled.
func applyOpnameChanges(ctx context.Context, q database.Querier, headerTable, linesTable, id, userID string,
	in opnamePatch, detail opnameState, load func() (*opnameState, error), now any) (bool, error) {
	if err := domain.AssertOpnameEditable(detail.status); err != nil {
		return false, httpx.BadRequest(err.Error())
	}
	if in.cancelled {
		_, err := q.Exec(ctx, `UPDATE `+headerTable+` SET status = 'cancelled', updated_by = $1, updated_at = $2 WHERE id = $3`, userID, now, id)
		return true, err
	}
	for _, line := range in.lines {
		var existing *opnameLineState
		for i := range detail.lines {
			if detail.lines[i].id == line.id {
				existing = &detail.lines[i]
				break
			}
		}
		if existing == nil {
			continue
		}
		var counted, variance any
		if line.qtyCounted != nil {
			counted = kit.N(*line.qtyCounted)
			variance = kit.N(*line.qtyCounted - existing.qtySystem)
		}
		notes := line.notes
		if notes == nil {
			notes = existing.notes
		}
		if _, err := q.Exec(ctx, `UPDATE `+linesTable+` SET qty_counted = $1, qty_variance = $2, notes = $3, updated_at = $4 WHERE id = $5`,
			counted, variance, notes, now, line.id); err != nil {
			return false, err
		}
	}
	refreshed, err := load()
	if err != nil {
		return false, err
	}
	if refreshed == nil {
		refreshed = &detail
	}
	counts := make([]domain.OpnameLineCount, len(refreshed.lines))
	for i, l := range refreshed.lines {
		counts[i] = domain.OpnameLineCount{Counted: l.qtyCounted, Variance: l.varian}
	}
	counted, withVariance, next := domain.SummarizeOpnameCounts(refreshed.status, counts)
	notes := in.notes
	if notes == nil {
		notes = refreshed.notes
	}
	_, err = q.Exec(ctx, `UPDATE `+headerTable+` SET lines_counted = $1, lines_with_variance = $2, status = $3, notes = $4,
		updated_by = $5, updated_at = $6 WHERE id = $7`, counted, withVariance, next, notes, userID, now, id)
	return false, err
}

/* ── raw material opnames (stock-opname-service.ts) ──────────────────── */

func opnameRef(row *kit.Row, idKey, nameKey, codeKey string) *kit.Row {
	if row.Str(idKey) == "" {
		return nil
	}
	name, code := row.Str(nameKey), row.Str(codeKey)
	if name == "" {
		name = "—"
	}
	return kit.Obj("id", row.Get(idKey), "name", name, "code", code)
}

func numOrNil(row *kit.Row, key string) any {
	if row.Get(key) == nil {
		return nil
	}
	return row.Num(key)
}

func rawOpnameHeader(row *kit.Row, lines any) *kit.Row {
	return kit.Obj(
		"id", row.Get("id"), "opname_number", row.Get("opname_number"), "warehouse_id", row.Get("warehouse_id"),
		"branch_id", row.Get("branch_id"), "opname_date", row.Get("opname_date"), "status", row.Get("status"),
		"reason", row.Get("reason"), "notes", row.Get("notes"), "total_lines", row.Get("total_lines"),
		"lines_counted", row.Get("lines_counted"), "lines_with_variance", row.Get("lines_with_variance"),
		"completed_at", row.Get("completed_at"), "created_at", row.Get("created_at"), "updated_at", row.Get("updated_at"),
		"warehouse", opnameRef(row, "warehouse_id", "warehouse_name", "warehouse_code"),
		"lines", lines,
	)
}

// fetchStockOpname is fetchStockOpnameDetail (nil when missing).
func fetchStockOpname(ctx context.Context, q database.Querier, id string) (*kit.Row, error) {
	header, err := kit.QueryOne(ctx, q, `SELECT so.*, wh.name AS warehouse_name, wh.code AS warehouse_code
		FROM inventory.stock_opnames so LEFT JOIN configuration.warehouses wh ON wh.id = so.warehouse_id
		WHERE so.id = $1`, id)
	if err != nil || header == nil {
		return nil, err
	}
	rows, err := kit.Query(ctx, q, `SELECT sol.*, rm.kode AS material_kode, rm.nama AS material_nama,
		u_besar.nama AS satuan, u_besar.nama AS satuan_besar_nama, u_kecil.nama AS satuan_kecil_nama, rm.konversi_factor
		FROM inventory.stock_opname_lines sol
		JOIN raw_materials rm ON rm.id = sol.raw_material_id
		LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
		LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
		WHERE sol.stock_opname_id = $1
		ORDER BY rm.nama ASC`, id)
	if err != nil {
		return nil, err
	}
	lines := make([]*kit.Row, len(rows))
	for i, l := range rows {
		lines[i] = kit.Obj(
			"id", l.Get("id"), "stock_opname_id", l.Get("stock_opname_id"), "inventory_id", l.Get("inventory_id"),
			"raw_material_id", l.Get("raw_material_id"), "qty_system", l.Num("qty_system"),
			"qty_counted", numOrNil(l, "qty_counted"), "qty_variance", numOrNil(l, "qty_variance"),
			"unit_cost", l.Num("unit_cost"), "notes", l.Get("notes"), "material_kode", l.Get("material_kode"),
			"material_nama", l.Get("material_nama"), "satuan", l.Get("satuan"), "satuan_besar_nama", l.Get("satuan_besar_nama"),
			"satuan_kecil_nama", l.Get("satuan_kecil_nama"), "konversi_factor", numOrNil(l, "konversi_factor"),
		)
	}
	return rawOpnameHeader(header, lines), nil
}

// opnameStateOf reads the fields applyOpnameChanges needs from a detail.
func opnameStateOf(detail *kit.Row) opnameState {
	st := opnameState{status: detail.Str("status"), notes: detail.StrPtr("notes")}
	lines, _ := detail.Get("lines").([]*kit.Row)
	for _, l := range lines {
		ls := opnameLineState{id: l.Str("id"), qtySystem: l.Num("qty_system"), notes: l.StrPtr("notes")}
		if v, ok := l.Get("qty_counted").(float64); ok {
			ls.qtyCounted = &v
		}
		if v, ok := l.Get("qty_variance").(float64); ok {
			ls.varian = &v
		}
		st.lines = append(st.lines, ls)
	}
	return st
}

func detailLines(detail *kit.Row) []*kit.Row {
	lines, _ := detail.Get("lines").([]*kit.Row)
	return lines
}

/* GET /api/inventory/stock-opnames */
func (h *handler) listStockOpnames(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	p, err := parseOpnameListQuery(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	a := &kit.Args{}
	cond := []string{"1=1"}
	if p.status != "" && p.status != "all" {
		cond = append(cond, "so.status = "+a.Add(p.status))
	}
	warehouse, err := kit.ResolveWarehouseFilter(ctx, h.env.DB, r, u.ID, p.warehouseID)
	if err != nil {
		return err
	}
	if warehouse != "" {
		cond = append(cond, "so.warehouse_id = "+a.Add(warehouse))
	}
	if p.reason != "" {
		cond = append(cond, "so.reason = "+a.Add(p.reason))
	}
	if p.search != "" {
		s := a.Add("%" + p.search + "%")
		cond = append(cond, "(so.opname_number ILIKE "+s+" OR so.notes ILIKE "+s+")")
	}
	if b := kit.Deref(ps.BranchFilter(scope)); b != "" {
		cond = append(cond, "so.branch_id = "+a.Add(b))
	}
	where := joinAnd(cond)
	var total string
	if err := h.env.DB.QueryRow(ctx, `SELECT COUNT(*)::text AS total FROM inventory.stock_opnames so WHERE `+where, a.Values...).Scan(&total); err != nil {
		return err
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT so.*, wh.name AS warehouse_name, wh.code AS warehouse_code
		FROM inventory.stock_opnames so LEFT JOIN configuration.warehouses wh ON wh.id = so.warehouse_id
		WHERE `+where+` ORDER BY so.opname_date DESC, so.created_at DESC
		LIMIT `+a.Add(kit.N(p.limit))+` OFFSET `+a.Add(kit.N((p.page-1)*p.limit)), a.Values...)
	if err != nil {
		return err
	}
	data := make([]*kit.Row, len(rows))
	for i, row := range rows {
		data[i] = rawOpnameHeader(row, []any{})
	}
	return kit.OK(w, struct {
		Success    bool             `json:"success"`
		Data       []*kit.Row       `json:"data"`
		Pagination opnamePagination `json:"pagination"`
	}{true, data, listPagination(p.page, p.limit, atoi(total))})
}

/* GET /api/inventory/stock-opnames/preview?warehouse_id= */
func (h *handler) stockOpnamePreview(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	f := kit.FromRequest(r)
	warehouse := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Gudang wajib dipilih"))
	if err := f.FlattenErr("Validasi gagal"); err != nil {
		return err
	}
	if _, werr, err := kit.ValidateWarehouse(r.Context(), h.env.DB, *warehouse, scope, nil); err != nil {
		return err
	} else if werr != "" {
		return httpx.BadRequest("Gudang tidak valid atau tidak diizinkan")
	}
	return h.writePreview(w, r, *warehouse)
}

// writePreview is `{ success, data: listWarehouseInventoryForOpname(id), total }`.
func (h *handler) writePreview(w http.ResponseWriter, r *http.Request, warehouseID string) error {
	rows, err := h.stockByWarehouse(r, warehouseID)
	if err != nil {
		return err
	}
	lines := make([]*kit.Row, len(rows))
	for i, row := range rows {
		lines[i] = previewLine(row)
	}
	return kit.OK(w, struct {
		Success bool       `json:"success"`
		Data    []*kit.Row `json:"data"`
		Total   int        `json:"total"`
	}{true, lines, len(lines)})
}

// previewLine is mapStockRowToOpnameLine.
func previewLine(row stockRow) *kit.Row {
	return kit.Obj(
		"inventory_id", row.InventoryID, "raw_material_id", row.RawMaterialID, "material_kode", row.Kode,
		"material_nama", row.Nama, "satuan", row.Satuan, "satuan_besar_nama", row.SatuanBesarNama,
		"satuan_kecil_nama", row.SatuanKecilNama, "konversi_factor", row.KonversiFactor,
		"qty_system", row.QtyOnhand, "unit_cost", row.UnitCost,
	)
}

/*
POST /api/inventory/stock-opnames — a draft session listing every

	material of the warehouse's branch with its system quantity.
*/
func (h *handler) createStockOpname(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	in, err := parseOpnameCreate(r, "Gudang wajib dipilih")
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	warehouseBranch, werr, err := kit.ValidateWarehouse(ctx, h.env.DB, in.warehouseID, scope, nil)
	if err != nil {
		return err
	}
	if werr != "" {
		return httpx.BadRequest("Gudang tidak valid atau tidak diizinkan")
	}
	rows, err := h.stockByWarehouse(r, in.warehouseID)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return httpx.BadRequest("Tidak ada bahan baku aktif di cabang gudang ini")
	}
	branchID := kit.Deref(ps.BranchFilter(scope))
	if branchID == "" {
		branchID = warehouseBranch
	}
	now := h.env.Now()
	var id string
	err = h.env.Tx(ctx, func(q database.Querier) error {
		if err := q.QueryRow(ctx, `INSERT INTO stock_opnames (warehouse_id, branch_id, opname_date, status, reason, notes,
			total_lines, lines_counted, lines_with_variance, created_by, updated_by)
			VALUES ($1, $2, $3, 'draft', $4, $5, $6, 0, 0, $7, $7) RETURNING id::text`,
			in.warehouseID, branchID, orDate(in.opnameDate, now), in.reason, kit.OrNil(in.notes), len(rows), u.ID).Scan(&id); err != nil {
			return err
		}
		for _, row := range rows {
			invID := kit.Deref(row.InventoryID)
			if invID == "" {
				if invID, err = ledger.EnsureWarehouseInventoryID(ctx, q, row.RawMaterialID, in.warehouseID, &branchID, row.UnitCost, u.ID); err != nil {
					return err
				}
			}
			if _, err := q.Exec(ctx, `INSERT INTO stock_opname_lines (stock_opname_id, inventory_id, raw_material_id,
				qty_system, qty_counted, qty_variance, unit_cost) VALUES ($1, $2, $3, $4, NULL, NULL, $5)`,
				id, invID, row.RawMaterialID, kit.N(row.QtyOnhand), kit.N(row.UnitCost)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	detail, err := fetchStockOpname(ctx, h.env.DB, id)
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", detail, "message", "Sesi stock opname berhasil dibuat"))
}

// orDate is `input || new Date().toISOString().slice(0, 10)`.
func orDate(date *string, now time.Time) string {
	if date != nil && *date != "" {
		return *date
	}
	return kit.UTCDate(now)
}

func joinAnd(cond []string) string { return strings.Join(cond, " AND ") }

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// httpxDate is the calendar date of a node-postgres `date` value.
func httpxDate(t httpx.JSTime) string { return time.Time(t).UTC().Format("2006-01-02") }

// stockOpnameOr404 is getStockOpnameOr404 (branch-scoped).
func (h *handler) stockOpnameOr404(ctx context.Context, id string, scope *ps.Scope) (*kit.Row, error) {
	detail, err := fetchStockOpname(ctx, h.env.DB, id)
	if err != nil {
		return nil, err
	}
	if b := kit.Deref(ps.BranchFilter(scope)); detail == nil || (b != "" && detail.Str("branch_id") != b) {
		return nil, httpx.NotFound("Stock opname tidak ditemukan")
	}
	return detail, nil
}

/* GET /api/inventory/stock-opnames/{id} */
func (h *handler) getStockOpname(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	detail, err := h.stockOpnameOr404(r.Context(), r.PathValue("id"), scope)
	if err != nil {
		return err
	}
	return kit.Data(w, detail)
}

/* PATCH /api/inventory/stock-opnames/{id} — cancel, or save counts. */
func (h *handler) patchStockOpname(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	in, err := parseOpnamePatch(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	detail, err := h.stockOpnameOr404(ctx, id, scope)
	if err != nil {
		return err
	}
	load := func() (*opnameState, error) {
		d, err := fetchStockOpname(ctx, h.env.DB, id)
		if err != nil || d == nil {
			return nil, err
		}
		st := opnameStateOf(d)
		return &st, nil
	}
	cancelled, err := applyOpnameChanges(ctx, h.env.DB, "stock_opnames", "stock_opname_lines", id, u.ID, in, opnameStateOf(detail), load, h.env.Now())
	if err != nil {
		return err
	}
	data, err := fetchStockOpname(ctx, h.env.DB, id)
	if err != nil {
		return err
	}
	msg := "Perubahan stock opname disimpan"
	if cancelled {
		msg = "Stock opname dibatalkan"
	}
	return kit.OK(w, kit.Obj("success", true, "data", data, "message", msg))
}

func countedFlags(lines []*kit.Row) []bool {
	out := make([]bool, len(lines))
	for i, l := range lines {
		out[i] = l.Get("qty_counted") != nil
	}
	return out
}

/*
POST /api/inventory/stock-opnames/{id}/complete — apply the variances to

	warehouse stock, then post the variance journal.
*/
func (h *handler) completeStockOpname(w http.ResponseWriter, r *http.Request) error {
	u, err := h.inventoryStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	detail, err := h.stockOpnameOr404(ctx, id, scope)
	if err != nil {
		return err
	}
	lines := detailLines(detail)
	if err := domain.AssertOpnameCompletable(detail.Str("status"), countedFlags(lines)); err != nil {
		return httpx.BadRequest(err.Error())
	}
	number := detail.Str("opname_number")
	err = h.env.Tx(ctx, func(q database.Querier) error {
		type variance struct {
			RawMaterialID string  `json:"raw_material_id"`
			InventoryID   any     `json:"inventory_id"`
			QtySystem     float64 `json:"qty_system"`
			QtyCounted    float64 `json:"qty_counted"`
		}
		variances := []variance{}
		for _, line := range lines {
			before, after := line.Num("qty_system"), line.Num("qty_counted")
			diff := after - before
			if after != before {
				variances = append(variances, variance{line.Str("raw_material_id"), line.Get("inventory_id"), before, after})
			}
			if diff == 0 {
				continue
			}
			inv, err := kit.QueryOne(ctx, q, `SELECT id, branch_id::text, warehouse_id::text, unit_cost
				FROM inventory.inventory WHERE id = $1 FOR UPDATE`, line.Get("inventory_id"))
			if err != nil {
				return err
			}
			if inv == nil {
				return errors.New("Inventory " + line.Str("inventory_id") + " tidak ditemukan")
			}
			if _, err := q.Exec(ctx, `UPDATE inventory.inventory SET qty_available = $1, last_movement_at = now(),
				updated_at = now(), updated_by = $2 WHERE id = $3`, kit.N(after), u.ID, line.Get("inventory_id")); err != nil {
				return err
			}
			unitCost := line.Num("unit_cost")
			if inv.Get("unit_cost") != nil {
				unitCost = inv.Num("unit_cost")
			}
			alasan := line.Str("notes")
			if alasan == "" {
				alasan = "Stock opname " + number + ": " + domain.SignedDiff(diff)
			}
			if err := ledger.InsertMovement(ctx, q, ledger.Movement{
				InventoryID: line.Str("inventory_id"), RawMaterialID: line.Str("raw_material_id"), Tipe: "adjustment",
				Jumlah: math.Abs(diff), QtyBefore: before, QtyAfter: after, UnitCost: &unitCost,
				TotalCost: kit.Ptr(math.Abs(diff) * unitCost), BranchID: inv.StrPtr("branch_id"), WarehouseID: inv.StrPtr("warehouse_id"),
				ReferenceType: "stock_opname", ReferenceID: &id, ReferenceNumber: &number, Alasan: &alasan,
				CreatedBy: &u.ID, UpdatedBy: &u.ID,
			}); err != nil {
				return err
			}
		}
		if _, err := q.Exec(ctx, `UPDATE inventory.stock_opnames SET status = 'completed', completed_at = now(),
			lines_counted = $2, lines_with_variance = $3, updated_by = $4, updated_at = now() WHERE id = $1`,
			id, len(lines), len(variances), u.ID); err != nil {
			return err
		}
		return kit.RecordAudit(ctx, q, kit.Audit{
			ActorID: u.ID, ActorName: &u.FullName, Action: "stock.opname_complete", Entity: "stock_opname",
			EntityID: &id, EntityLabel: &number,
			Before: kit.Obj("status", detail.Get("status")),
			After:  kit.Obj("status", "completed", "lines_counted", len(lines), "variances", variances),
			Meta:   kit.MetaOf(r),
		})
	})
	if err != nil {
		return err
	}
	note, err := h.postOpnameJournal(ctx, detail, u)
	if err != nil {
		return err
	}
	data, err := fetchStockOpname(ctx, h.env.DB, id)
	if err != nil {
		return err
	}
	msg := "Stock opname selesai dan stok telah disesuaikan"
	if note != nil && *note != "" {
		msg += " (" + *note + ")"
	}
	return kit.OK(w, kit.Obj("success", true, "data", data, "message", msg, "accounting_note", note))
}

// postOpnameJournal is postStockOpnameVarianceJournal. The TS passes
// String(detail.opname_date).slice(0, 10), which for the Date node-postgres
// returns is "Sun Oct 04"; the journal gets the YYYY-MM-DD date instead.
func (h *handler) postOpnameJournal(ctx context.Context, detail *kit.Row, u *auth.User) (*string, error) {
	company, err := companyOfBranch(ctx, h.env.DB, detail.StrPtr("branch_id"))
	if err != nil {
		return nil, err
	}
	var lines []VarianceLine
	for _, l := range detailLines(detail) {
		lines = append(lines, VarianceLine{
			RawMaterialID: l.Str("raw_material_id"), QtyDiff: l.Num("qty_counted") - l.Num("qty_system"),
			UnitCost: l.Num("unit_cost"), MaterialNama: l.StrPtr("material_nama"),
		})
	}
	date := ""
	if t, ok := detail.Get("opname_date").(httpx.JSTime); ok {
		date = httpxDate(t)
	}
	return h.ports.Journals.PostStockOpname(ctx, h.env.DB, OpnameJournal{
		CompanyID: company, UserID: u.ID, OpnameID: detail.Str("id"), OpnameNumber: detail.Str("opname_number"),
		OpnameDate: date, Lines: lines,
	})
}
