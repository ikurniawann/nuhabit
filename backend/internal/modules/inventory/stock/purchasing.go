package stock

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"nuhabit/backend/internal/platform/audit"
	ps "nuhabit/backend/internal/platform/scope"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// /api/purchasing/inventory/** (frontend/src/lib/purchasing/inventory-queries.ts,
// inventory-stock-moves.ts and frontend/src/lib/inventory/stock-transfer.ts).

/* GET /api/purchasing/inventory — material stock at the active stall or in aggregate. */
func (h *handler) purchasingStock(w http.ResponseWriter, r *http.Request) error {
	u, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	ctx := r.Context()
	src, err := kit.RawMaterialStockSource(ctx, h.env.DB, r, u.ID)
	if err != nil {
		return err
	}
	sp := r.URL.Query()
	a := &kit.Args{}
	where := []string{`"is_active" = ` + a.Add(true), `"deleted_at" IS NULL`}
	if src.WarehouseID != "" {
		where = append(where, `"warehouse_id" = `+a.Add(src.WarehouseID))
	}
	if c := kit.Deref(ps.CompanyFilter(scope)); c != "" {
		where = append(where, `("company_id" = `+a.Add(c)+`)`)
	}
	if b := kit.Deref(ps.BranchFilter(scope)); b != "" {
		where = append(where, `("branch_id" = `+a.Add(b)+`)`)
	}
	if sp.Get("below_minimum") == "true" {
		where = append(where, kit.Or(a, "", "status_stok.eq.MENIPIS,status_stok.eq.HABIS"))
	}
	if s := sp.Get("search"); s != "" {
		where = append(where, kit.Search(a, "", s, "nama", "kode"))
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT * FROM `+src.View+` WHERE `+strings.Join(where, " AND ")+` ORDER BY "nama" ASC`, a.Values...)
	if err != nil {
		return err
	}
	return kit.Data(w, rows)
}

/* GET /api/purchasing/inventory/{id} — one material's stock row (no scope check, as in TS). */
func (h *handler) purchasingStockDetail(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	src, err := kit.RawMaterialStockSource(ctx, h.env.DB, r, u.ID)
	if err != nil {
		return err
	}
	a := &kit.Args{}
	sql := `SELECT * FROM ` + src.View + ` WHERE "id" = ` + a.Add(r.PathValue("id"))
	if src.WarehouseID != "" {
		sql += ` AND "warehouse_id" = ` + a.Add(src.WarehouseID)
	}
	row, err := kit.QueryOne(ctx, h.env.DB, sql, a.Values...)
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound("Inventory tidak ditemukan")
	}
	return kit.Data(w, row)
}

/*
GET /api/purchasing/inventory/{id}/movements?limit= — latest movements of

	one material with the material row embedded.
*/
func (h *handler) purchasingMaterialMovements(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	limit := kit.IntParam(r.URL.Query(), "limit", "50")
	rows, err := kit.Query(r.Context(), h.env.DB, `SELECT *,
		(SELECT row_to_json(e) FROM (SELECT * FROM "item"."raw_materials" WHERE "id" = "inventory_movements"."raw_material_id") e) AS "raw_material"
		FROM "inventory_movements" WHERE "raw_material_id" = $1 ORDER BY "created_at" DESC LIMIT $2`,
		r.PathValue("id"), kit.N(limit))
	if err != nil {
		return err
	}
	return kit.Data(w, rows)
}

// errBrokenMovementsEmbed is the failure the TS route always hits: its
// select embeds `inventory:inventory_id(id)` and `creator:created_by(...)`,
// which the query builder shim cannot resolve (no table named inventory_id;
// created_by has no foreign key), so every valid request answers 500.
var errBrokenMovementsEmbed = errors.New("purchasing inventory movements: TS embed inventory:inventory_id has no foreign key")

/*
GET /api/purchasing/inventory/movements — validated like TS, then the same

	500 the TS route returns (see errBrokenMovementsEmbed).
*/
func (h *handler) purchasingMovements(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	f := kit.NewQueryForm(r.URL.Query())
	f.UUID("bahan_id", validate.Rule{Optional: true})
	f.Coerce("page", kit.Ptr(1.0), validate.NumOpts{Min: validate.Bound(1)})
	f.Coerce("limit", kit.Ptr(20.0), validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(100)})
	f.Enum("tipe", validate.Rule{Optional: true}, []string{"in", "out", "adjustment", "transfer", "return"})
	f.Str("date_from", validate.Rule{Optional: true}, validate.StrOpts{})
	f.Str("date_to", validate.Rule{Optional: true}, validate.StrOpts{})
	f.Str("reference_type", validate.Rule{Optional: true}, validate.StrOpts{})
	if err := kit.FirstIssueErr(f.Form); err != nil {
		return err
	}
	return errBrokenMovementsEmbed
}

// requireWarehouseInScope is the 400 wrapper around ValidateWarehouse.
func (h *handler) requireWarehouseInScope(ctx context.Context, warehouseID string, scope *ps.Scope, message string) (string, error) {
	branch, werr, err := kit.ValidateWarehouse(ctx, h.env.DB, warehouseID, scope, nil)
	if err != nil {
		return "", err
	}
	if werr != "" {
		return "", httpx.BadRequest(message)
	}
	return branch, nil
}

// materialInScope is loadMaterialInScope: an unknown material passes (old
// behaviour); one outside the caller's scope is a 403.
func (h *handler) materialInScope(ctx context.Context, scope *ps.Scope, rawMaterialID, forbidden string) (*kit.Row, error) {
	m, err := kit.QueryOne(ctx, h.env.DB, `SELECT company_id::text, branch_id::text, kode FROM raw_materials WHERE id = $1`, rawMaterialID)
	if err != nil && database.PgCode(err) != "22P02" {
		return nil, err
	}
	if m != nil && !ps.RowInScope(scope, m.StrPtr("company_id"), m.StrPtr("branch_id")) {
		return nil, httpx.Forbidden(forbidden)
	}
	return m, nil
}

/*
POST /api/purchasing/inventory/adjustment — set one material's stock at a

	warehouse to the counted quantity.
*/
func (h *handler) adjustRawMaterial(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	rawMaterialID := f.Str("raw_material_id", validate.Rule{}, uuidMsg("Bahan baku wajib dipilih"))
	warehouseID := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Gudang wajib dipilih"))
	qtyActual := kit.NumCheck(f, "qty_actual", validate.Rule{}, kit.Min(0, "Stok aktual minimal 0"))
	notes := f.Str("notes", validate.Rule{Optional: true}, validate.StrOpts{})
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	warehouseBranch, err := h.requireWarehouseInScope(ctx, *warehouseID, scope, "Gudang tidak valid atau tidak diizinkan")
	if err != nil {
		return err
	}
	branchID := kit.Deref(ps.BranchFilter(scope))
	if branchID == "" {
		branchID = warehouseBranch
	}
	material, err := h.materialInScope(ctx, scope, *rawMaterialID, "Bahan baku tidak tersedia untuk cabang Anda")
	if err != nil {
		return err
	}
	stock, err := h.stockByWarehouse(r, *warehouseID)
	if err != nil {
		return err
	}
	var line *stockRow
	for i := range stock {
		if stock[i].RawMaterialID == *rawMaterialID {
			line = &stock[i]
			break
		}
	}
	if line == nil {
		return httpx.NotFound("Bahan baku tidak ditemukan di gudang ini")
	}
	now := h.env.Now()
	db := h.env.DB
	invID := kit.Deref(line.InventoryID)
	if invID == "" {
		if invID, err = ledger.EnsureWarehouseInventoryID(ctx, db, *rawMaterialID, *warehouseID, &branchID, line.UnitCost, u.ID); err != nil {
			return err
		}
	}
	cur, err := kit.QueryOne(ctx, db, `SELECT * FROM inventory WHERE id = $1`, invID)
	if err != nil || cur == nil {
		return httpx.NotFound("Data inventory tidak ditemukan untuk gudang ini")
	}
	qtyBefore := cur.Num("qty_available")
	diff := *qtyActual - qtyBefore
	adjustment := kit.Obj("qty_before", qtyBefore, "qty_after", *qtyActual, "qty_diff", diff)
	unitCost := cur.Num("unit_cost")
	updated, err := kit.QueryOne(ctx, db, `UPDATE inventory SET qty_available = $1, last_movement_at = $2, updated_at = $2,
		updated_by = $3 WHERE id = $4 RETURNING *`, kit.N(*qtyActual), now, u.ID, invID)
	if err != nil {
		return err
	}
	if diff == 0 {
		return kit.OK(w, kit.Obj("success", true, "data", updated, "message", "Stok berhasil disesuaikan", "adjustment", adjustment))
	}

	referenceID := kit.NewUUID()
	warehouse := cur.StrPtr("warehouse_id")
	if warehouse == nil {
		warehouse = warehouseID
	}
	alasan := kit.Deref(notes)
	if alasan == "" {
		alasan = "Penyesuaian stok: " + domain.SignedDiff(diff)
	}
	if err := ledger.InsertMovement(ctx, db, ledger.Movement{
		InventoryID: invID, RawMaterialID: *rawMaterialID, Tipe: "adjustment", Jumlah: math.Abs(diff),
		QtyBefore: qtyBefore, QtyAfter: *qtyActual, UnitCost: &unitCost, TotalCost: kit.Ptr(math.Abs(diff) * unitCost),
		BranchID: cur.StrPtr("branch_id"), WarehouseID: warehouse, ReferenceType: "adjustment", ReferenceID: &referenceID,
		Alasan: &alasan, CreatedBy: &u.ID, UpdatedBy: &u.ID,
	}); err != nil {
		return err
	}
	h.auditAfterCommit(r, audit.Entry{
		ActorID: u.ID, ActorName: &u.FullName, Action: "stock.adjust", Entity: "inventory", EntityID: &invID,
		EntityLabel: materialKode(material),
		Before:      kit.Obj("qty_available", qtyBefore),
		After: kit.Obj("qty_available", *qtyActual, "qty_diff", diff, "raw_material_id", *rawMaterialID,
			"warehouse_id", *warehouseID),
		Reason: notes,
	}.WithRequest(r))

	company, err := companyOfBranch(ctx, db, cur.StrPtr("branch_id"))
	if err != nil {
		return err
	}
	if company == nil && material != nil {
		company = material.StrPtr("company_id")
	}
	note, err := h.ports.Journals.PostStockAdjustment(ctx, db, AdjustmentJournal{
		CompanyID: company, UserID: u.ID, DocumentID: referenceID, EntryDate: kit.UTCDate(now),
		RawMaterialID: *rawMaterialID, QtyDiff: diff, UnitCost: unitCost, Notes: notes,
	})
	if err != nil {
		return err
	}
	msg := "Stok berhasil disesuaikan"
	if note != nil && *note != "" {
		msg += " (" + *note + ")"
	}
	return kit.OK(w, kit.Obj("success", true, "data", updated, "message", msg, "accounting_note", note, "adjustment", adjustment))
}

func materialKode(m *kit.Row) *string {
	if m == nil {
		return nil
	}
	return m.StrPtr("kode")
}

// auditAfterCommit is recordAuditAfterCommit: a failure is logged, never
// returned.
func (h *handler) auditAfterCommit(r *http.Request, a audit.Entry) {
	if err := audit.Write(r.Context(), h.env.DB, a); err != nil {
		h.env.Log.ErrorContext(r.Context(), "audit: gagal mencatat", "action", a.Action, "error", err)
	}
}

/* ── transfers ───────────────────────────────────────────────────────── */

/* GET /api/purchasing/inventory/transfer?page=&limit= */
func (h *handler) listTransfers(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := kit.NewQueryForm(r.URL.Query())
	page := f.Coerce("page", kit.Ptr(1.0), validate.NumOpts{Min: validate.Bound(1)})
	limit := f.Coerce("limit", kit.Ptr(20.0), validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(100)})
	if err := kit.FirstIssueErr(f.Form); err != nil {
		return err
	}
	ctx := r.Context()
	branch := ps.EffectiveBranchID(scope)
	var total string
	if err := h.env.DB.QueryRow(ctx, `SELECT COUNT(*)::text AS total FROM inventory_movements out_mov
		WHERE out_mov.reference_type = 'stock_transfer' AND out_mov.tipe = 'out' AND out_mov.is_active = true
		  AND ($1::uuid IS NULL OR out_mov.branch_id = $1)`, branch).Scan(&total); err != nil {
		return err
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT out_mov.id, out_mov.reference_id, out_mov.reference_number AS transfer_number,
		out_mov.raw_material_id, rm.kode AS material_kode, rm.nama AS material_nama, out_mov.jumlah::float8 AS qty,
		src.id AS source_warehouse_id, src.name AS source_warehouse_name, src.code AS source_warehouse_code,
		dst.id AS dest_warehouse_id, dst.name AS dest_warehouse_name, dst.code AS dest_warehouse_code,
		out_mov.catatan AS notes, out_mov.created_at::text AS created_at, u.full_name AS created_by_name
		FROM inventory_movements out_mov
		INNER JOIN inventory_movements in_mov ON in_mov.reference_id = out_mov.reference_id
		  AND in_mov.reference_type = 'stock_transfer' AND in_mov.tipe = 'in' AND in_mov.is_active = true
		INNER JOIN raw_materials rm ON rm.id = out_mov.raw_material_id
		INNER JOIN warehouses src ON src.id = out_mov.warehouse_id
		INNER JOIN warehouses dst ON dst.id = in_mov.warehouse_id
		LEFT JOIN users u ON u.id = out_mov.created_by
		WHERE out_mov.reference_type = 'stock_transfer' AND out_mov.tipe = 'out' AND out_mov.is_active = true
		  AND ($1::uuid IS NULL OR out_mov.branch_id = $1)
		ORDER BY out_mov.created_at DESC
		LIMIT $2 OFFSET $3`, branch, kit.N(*limit), kit.N((*page-1)**limit))
	if err != nil {
		return err
	}
	for _, row := range rows {
		row.Set("transfer_kind", domain.InferTransferKind(row.Str("source_warehouse_code"), row.Str("dest_warehouse_code")))
	}
	n := atoi(total)
	type pagination struct {
		Page       kit.Float `json:"page"`
		Limit      kit.Float `json:"limit"`
		Total      int       `json:"total"`
		TotalPages kit.Float `json:"total_pages"`
	}
	return kit.OK(w, struct {
		Success    bool       `json:"success"`
		Data       kit.Rows   `json:"data"`
		Pagination pagination `json:"pagination"`
	}{true, rows, pagination{kit.Float(*page), kit.Float(*limit), n, kit.Float(math.Ceil(float64(n) / *limit))}})
}

/* GET /api/purchasing/inventory/transfer/preview?warehouse_id= */
func (h *handler) transferPreview(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.itemsStaff)
	if err != nil {
		return err
	}
	f := kit.NewQueryForm(r.URL.Query())
	warehouse := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Source stall is required"))
	if err := kit.FirstIssueErr(f.Form); err != nil {
		return err
	}
	if _, err := h.requireWarehouseInScope(r.Context(), *warehouse, scope, "Source stall is invalid or not allowed"); err != nil {
		return err
	}
	return h.writePreview(w, r, *warehouse)
}

// transferRuleError marks the executeStockTransfer messages the route
// answers with 400 (isTransferRuleError).
type transferRuleError string

func (e transferRuleError) Error() string { return string(e) }

type warehouseInfo struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	BranchID  string `json:"branch_id"`
	IsDefault bool   `json:"is_default"`
}

type transferResult struct {
	TransferNumber  string        `json:"transfer_number"`
	ReferenceID     string        `json:"reference_id"`
	Qty             float64       `json:"qty"`
	UnitCost        float64       `json:"unit_cost"`
	SourceWarehouse warehouseInfo `json:"source_warehouse"`
	DestWarehouse   warehouseInfo `json:"dest_warehouse"`
}

func fetchWarehouseInfo(ctx context.Context, q database.Querier, id string) (*warehouseInfo, error) {
	var w warehouseInfo
	err := q.QueryRow(ctx, `SELECT id::text, code, name, branch_id::text, is_default FROM warehouses
		WHERE id = $1 AND is_active = true`, id).Scan(&w.ID, &w.Code, &w.Name, &w.BranchID, &w.IsDefault)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &w, err
}

// executeTransfer is executeStockTransfer, run in one transaction.
func (h *handler) executeTransfer(ctx context.Context, q database.Querier, rawMaterialID, sourceID, destID, kind string, qty float64, notes *string, userID string) (transferResult, error) {
	var res transferResult
	if kit.ToNum(qty) <= 0 {
		return res, transferRuleError("Transfer quantity must be greater than zero")
	}
	source, err := fetchWarehouseInfo(ctx, q, sourceID)
	if err != nil {
		return res, err
	}
	dest, err := fetchWarehouseInfo(ctx, q, destID)
	if err != nil {
		return res, err
	}
	if source == nil {
		return res, transferRuleError("Source stall not found")
	}
	if dest == nil {
		return res, transferRuleError("Destination stall not found")
	}
	if msg := domain.ValidateTransferWarehouses(kind,
		domain.TransferWarehouse{ID: source.ID, Code: source.Code, BranchID: source.BranchID},
		domain.TransferWarehouse{ID: dest.ID, Code: dest.Code, BranchID: dest.BranchID}); msg != "" {
		return res, transferRuleError(msg)
	}
	src, err := kit.QueryOne(ctx, q, `SELECT * FROM inventory WHERE raw_material_id = $1 AND warehouse_id = $2 AND is_active = true
		LIMIT 1 FOR UPDATE`, rawMaterialID, sourceID)
	if err != nil {
		return res, err
	}
	if src == nil {
		return res, transferRuleError("Raw material is not available at the source stall")
	}
	srcBefore := src.Num("qty_available")
	if srcBefore < qty {
		return res, transferRuleError("Insufficient stock. Available: " + kit.JSNum(srcBefore))
	}
	srcAfter := srcBefore - qty
	unitCost := src.Num("unit_cost")
	branchID := source.BranchID
	number, err := nextTransferNumber(ctx, q, h.env.Now())
	if err != nil {
		return res, err
	}
	referenceID := kit.NewUUID()
	destInvID, err := ledger.EnsureWarehouseInventoryID(ctx, q, rawMaterialID, destID, &branchID, unitCost, userID)
	if err != nil {
		return res, err
	}
	dst, err := kit.QueryOne(ctx, q, `SELECT * FROM inventory WHERE id = $1 FOR UPDATE`, destInvID)
	if err != nil {
		return res, err
	}
	if dst == nil {
		return res, errors.New("Failed to load destination inventory")
	}
	dstBefore := dst.Num("qty_available")
	dstAfter := dstBefore + qty
	dstCost := domain.WeightedAverage(dstBefore, dst.Num("unit_cost"), qty, unitCost)
	now := h.env.Now()
	if _, err := q.Exec(ctx, `UPDATE inventory SET qty_available = $1, last_movement_at = $2, updated_at = $2, updated_by = $3
		WHERE id = $4`, kit.N(srcAfter), now, userID, src.Str("id")); err != nil {
		return res, err
	}
	if _, err := q.Exec(ctx, `UPDATE inventory SET qty_available = $1, unit_cost = $2, last_movement_at = $3, updated_at = $3,
		updated_by = $4 WHERE id = $5`, kit.N(dstAfter), kit.N(dstCost), now, userID, destInvID); err != nil {
		return res, err
	}
	base := ledger.Movement{
		RawMaterialID: rawMaterialID, Jumlah: qty, BranchID: &branchID, ReferenceType: "stock_transfer",
		ReferenceID: &referenceID, ReferenceNumber: &number, Catatan: notes, CreatedBy: &userID, UpdatedBy: &userID,
	}
	out := base
	out.InventoryID, out.Tipe, out.QtyBefore, out.QtyAfter = src.Str("id"), "out", srcBefore, srcAfter
	out.UnitCost, out.TotalCost, out.WarehouseID = &unitCost, kit.Ptr(qty*unitCost), &sourceID
	out.Alasan = kit.Ptr("Transfer to " + dest.Name + " (" + dest.Code + ")")
	if err := ledger.InsertMovement(ctx, q, out); err != nil {
		return res, err
	}
	in := base
	in.InventoryID, in.Tipe, in.QtyBefore, in.QtyAfter = destInvID, "in", dstBefore, dstAfter
	in.UnitCost, in.TotalCost, in.WarehouseID = &dstCost, kit.Ptr(qty*dstCost), &destID
	in.Alasan = kit.Ptr("Transfer from " + source.Name + " (" + source.Code + ")")
	if err := ledger.InsertMovement(ctx, q, in); err != nil {
		return res, err
	}
	return transferResult{number, referenceID, qty, unitCost, *source, *dest}, nil
}

// nextTransferNumber is generateTransferNumber: TRF-YYYYMMDD-NNNN after the
// day's highest number (server date; the TS server runs in UTC).
func nextTransferNumber(ctx context.Context, q database.Querier, now time.Time) (string, error) {
	prefix := "TRF-" + now.UTC().Format("20060102")
	last, err := kit.QueryOne(ctx, q, `SELECT reference_number FROM inventory_movements
		WHERE reference_type = 'stock_transfer' AND reference_number ILIKE $1
		ORDER BY reference_number DESC LIMIT 1`, prefix+"-%")
	if err != nil {
		return "", err
	}
	seq := 1
	if last != nil {
		parts := strings.Split(last.Str("reference_number"), "-")
		if n, ok := kit.ParseInt(parts[len(parts)-1]); ok {
			seq = n + 1
		}
	}
	return fmt.Sprintf("%s-%04d", prefix, seq), nil
}

/*
POST /api/purchasing/inventory/transfer — move stock between stalls of a

	branch, audit it, then post the transfer journal.
*/
func (h *handler) transfer(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	kind := kit.Enum(f, "transfer_kind", validate.Rule{}, []string{"main_to_stall", "stall_to_stall", "stall_to_main"}, "")
	sourceID := f.Str("source_warehouse_id", validate.Rule{}, uuidMsg("Source stall is required"))
	destID := f.Str("dest_warehouse_id", validate.Rule{}, uuidMsg("Destination stall is required"))
	rawMaterialID := f.Str("raw_material_id", validate.Rule{}, uuidMsg("Raw material is required"))
	qty := kit.NumCheck(f, "qty", validate.Rule{}, kit.Positive("Quantity must be greater than zero"))
	notes := f.Str("notes", validate.Rule{Optional: true}, validate.StrOpts{})
	if err := kit.FirstIssueErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	scope, err := h.env.Scope(ctx, u)
	if err != nil {
		return err
	}
	if _, err := h.requireWarehouseInScope(ctx, *sourceID, scope, "Source stall is invalid or not allowed"); err != nil {
		return err
	}
	if _, err := h.requireWarehouseInScope(ctx, *destID, scope, "Destination stall is invalid or not allowed"); err != nil {
		return err
	}
	material, err := h.materialInScope(ctx, scope, *rawMaterialID, "Raw material is not available for your branch")
	if err != nil {
		return err
	}
	var trimmed *string
	if notes != nil {
		if t := validate.JSTrim(*notes); t != "" {
			trimmed = &t
		}
	}
	var res transferResult
	err = h.env.Tx(ctx, func(q database.Querier) error {
		res, err = h.executeTransfer(ctx, q, *rawMaterialID, *sourceID, *destID, *kind, *qty, trimmed, u.ID)
		return err
	})
	var rule transferRuleError
	if errors.As(err, &rule) {
		return httpx.BadRequest(rule.Error())
	}
	if err != nil {
		return err
	}
	h.auditAfterCommit(r, audit.Entry{
		ActorID: u.ID, ActorName: &u.FullName, Action: "stock.transfer", Entity: "stock_transfer",
		EntityID: &res.ReferenceID, EntityLabel: &res.TransferNumber,
		After: kit.Obj("raw_material_id", *rawMaterialID, "qty", res.Qty, "unit_cost", res.UnitCost,
			"source_warehouse_id", *sourceID, "dest_warehouse_id", *destID, "transfer_kind", *kind),
		Reason: notes,
	}.WithRequest(r))
	var company *string
	if material != nil {
		company = material.StrPtr("company_id")
	}
	note, err := h.ports.Journals.PostStockTransfer(ctx, h.env.DB, TransferJournal{
		CompanyID: company, UserID: u.ID, TransferID: res.ReferenceID, TransferNumber: res.TransferNumber,
		EntryDate: kit.UTCDate(h.env.Now()), RawMaterialID: *rawMaterialID, Qty: res.Qty, UnitCost: res.UnitCost,
		SourceWarehouseName: res.SourceWarehouse.Name, DestWarehouseName: res.DestWarehouse.Name,
	})
	if err != nil {
		return err
	}
	msg := "Stock transferred successfully (" + res.TransferNumber + ")"
	if note != nil && *note != "" {
		msg += " (" + *note + ")"
	}
	return kit.OK(w, struct {
		Success        bool           `json:"success"`
		Message        string         `json:"message"`
		AccountingNote *string        `json:"accounting_note"`
		Data           transferResult `json:"data"`
	}{true, msg, note, res})
}
