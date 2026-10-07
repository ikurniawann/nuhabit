package procurement

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Port of lib/purchasing/delivery-service.ts, delivery-mappers.ts and
// receiving-workspace.ts.

// DeliveryListParams is deliveryListQuerySchema.
type DeliveryListParams struct {
	Search, Status, SupplierID, VendorID, PoID *string
	ModuleType                                 *string
	Page, Limit                                float64
	SortBy, SortDir                            string
}

// poIDsByModule is getPurchaseOrderIdsByModuleType (active POs only).
func (s *Service) poIDsByModule(ctx context.Context, q database.Querier, moduleType string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM purchase_orders WHERE module_type = $1 AND is_active = true`, moduleType)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// orDashStr is `value || "-"`.
func orDashStr(values ...any) any {
	for _, v := range values {
		if v != nil && v != "" {
			return v
		}
	}
	return "-"
}

// ListDeliveries is listDeliveries.
func (s *Service) ListDeliveries(ctx context.Context, p DeliveryListParams, scope *pscope.Scope) ([]*Row, int, error) {
	w := newWhere().add("is_active = %s", true)
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("branch_id = %s::text::uuid", *b)
	}
	if p.ModuleType != nil {
		ids, err := s.poIDsByModule(ctx, s.db, *p.ModuleType)
		if err != nil {
			return nil, 0, err
		}
		if len(ids) == 0 {
			return []*Row{}, 0, nil
		}
		w.add("purchase_order_id = ANY(%s::uuid[])", ids)
	}
	if set(p.Search) {
		pattern := strings.ReplaceAll("%"+*p.Search+"%", "*", "%")
		w.add("(no_surat_jalan ILIKE %s OR no_resi ILIKE %s)", pattern, pattern)
	}
	if set(p.Status) {
		w.add("status = %s", *p.Status)
	}
	if set(p.SupplierID) {
		w.add("supplier_id = %s::text::uuid", *p.SupplierID)
	}
	if set(p.VendorID) {
		w.add("vendor_id = %s::text::uuid", *p.VendorID)
	}
	if set(p.PoID) {
		w.add("purchase_order_id = %s::text::uuid", *p.PoID)
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM deliveries `+w.sql(), w.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	limit, offset := w.next(formatJSNumber(p.Limit)), w.next(formatJSNumber((p.Page-1)*p.Limit))
	rows, err := s.rows.Query(ctx, s.db, `SELECT * FROM deliveries `+w.sql()+` ORDER BY `+p.SortBy+` `+p.SortDir+
		` LIMIT `+limit+`::text::bigint OFFSET `+offset+`::text::bigint`, w.args...)
	if err != nil {
		return nil, 0, err
	}
	pos, err := s.lookup(ctx, `SELECT id::text, nomor_po FROM purchase_orders WHERE id = ANY($1::uuid[])`, uniqueStrings(column(rows, "purchase_order_id")))
	if err != nil {
		return nil, 0, err
	}
	out := make([]*Row, len(rows))
	for i, r := range rows {
		poNumber := any(pos[r.Str("purchase_order_id")])
		out[i] = obj(
			"id", r.Get("id"),
			"delivery_number", orDashStr(r.Get("nomor_resi"), r.Get("no_resi")),
			"po_id", r.Get("purchase_order_id"),
			"po_number", orDashStr(poNumber),
			"no_surat_jalan", orDashStr(r.Get("no_surat_jalan")),
			"ekspedisi", orDashStr(r.Get("kurir")),
			"no_resi", orDashStr(r.Get("no_resi"), r.Get("nomor_resi")),
			"tanggal_kirim", r.Get("tanggal_kirim"), "tanggal_estimasi_tiba", r.Get("tanggal_estimasi_tiba"),
			"tanggal_aktual_tiba", r.Get("tanggal_aktual_tiba"), "status", r.Get("status"), "created_at", r.Get("created_at"))
	}
	return out, total, nil
}

// createDeliveryInput is createDeliverySchema.
type createDeliveryInput struct {
	PoID                                        string
	SupplierID, VendorID, ModuleType            *string
	TanggalKirim, NoSuratJalan, TanggalEstimasi string
	NoResi, Kurir, Catatan                      *string
}

// CreateDelivery is createDelivery.
func (s *Service) CreateDelivery(ctx context.Context, in *createDeliveryInput, userID string, scope *pscope.Scope) (*Row, error) {
	moduleType := domain.ModuleType(deref(in.ModuleType))
	errs, err := s.validatePOCanDelivery(ctx, s.db, in.PoID)
	if err != nil {
		return nil, err
	}
	if len(errs) > 0 {
		return nil, badRequest(strings.Join(errs, " "))
	}
	po, err := s.rows.One(ctx, s.db, `SELECT company_id, branch_id, module_type, vendor_id, supplier_id FROM purchase_orders WHERE id = $1::text::uuid`, in.PoID)
	if err != nil {
		return nil, err
	}
	poField := func(key string) *string {
		if po == nil {
			return nil
		}
		return po.StrPtr(key)
	}
	poModule := deref(poField("module_type"))
	if moduleType == "product" && poModule != "product" {
		return nil, badRequest("Purchase order is not a product purchase order")
	}
	if moduleType == "raw_material" && poModule == "product" {
		return nil, badRequest("Use product delivery flow for this purchase order")
	}
	var supplier, vendor *string
	switch moduleType {
	case "raw_material":
		supplier = firstNonNil(nonEmpty(in.SupplierID), poField("supplier_id"))
	case "product":
		vendor = firstNonNil(nonEmpty(in.VendorID), poField("vendor_id"))
	}
	tanggal := in.TanggalKirim
	if tanggal == "" {
		tanggal = s.now().UTC().Format("2006-01-02")
	}
	delivery, err := s.rows.One(ctx, s.db, `INSERT INTO deliveries
		(purchase_order_id, supplier_id, vendor_id, tanggal_kirim, no_surat_jalan, no_resi, kurir, tanggal_estimasi_tiba,
		 status, catatan, company_id, branch_id, created_by)
		VALUES ($1::text::uuid, $2, $3, $4::text::date, $5, $6, $7, $8::text::date, 'pending', $9, $10, $11, $12) RETURNING *`,
		in.PoID, supplier, vendor, tanggal, in.NoSuratJalan, in.NoResi, in.Kurir, in.TanggalEstimasi, in.Catatan,
		firstNonNil(poField("company_id"), pscope.EffectiveCompanyID(scope)), firstNonNil(poField("branch_id"), pscope.EffectiveBranchID(scope)), userID)
	if err != nil || delivery == nil {
		s.log.ErrorContext(ctx, "Error creating delivery", "error", err)
		return nil, httpx.Status(500, "Gagal membuat delivery")
	}
	return delivery, nil
}

// deliveryOr404 is getDeliveryOrThrow.
func (s *Service) deliveryOr404(ctx context.Context, q database.Querier, id string) (*Row, error) {
	d, err := s.rows.One(ctx, q, `SELECT * FROM deliveries WHERE id = $1::text::uuid`, id)
	if err != nil || d == nil {
		return nil, notFound("Delivery tidak ditemukan")
	}
	return d, nil
}

// DeliveryDetail is getDeliveryDetail.
func (s *Service) DeliveryDetail(ctx context.Context, id string) (*Row, error) {
	d, err := s.deliveryOr404(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	maybe := func(sql, id string) (*Row, error) {
		if id == "" {
			return nil, nil
		}
		return s.rows.One(ctx, s.db, sql, id)
	}
	supplier, err := maybe(`SELECT * FROM suppliers WHERE id = $1`, d.Str("supplier_id"))
	if err != nil {
		return nil, err
	}
	vendor, err := maybe(`SELECT id, code, name FROM vendors WHERE id = $1`, d.Str("vendor_id"))
	if err != nil {
		return nil, err
	}
	po, err := maybe(`SELECT * FROM purchase_orders WHERE id = $1`, d.Str("purchase_order_id"))
	if err != nil {
		return nil, err
	}
	var supplierRef, vendorRef, poRef any
	if supplier != nil {
		supplierRef = obj("id", supplier.Get("id"), "nama", orDashStr(supplier.Get("nama_supplier"), supplier.Get("nama")),
			"kode", orEmpty(supplier.Get("kode_supplier"), supplier.Get("kode")))
	}
	if vendor != nil {
		vendorRef = obj("id", vendor.Get("id"), "nama", orDashStr(vendor.Get("name")), "kode", orEmpty(vendor.Get("code")))
	}
	if po != nil {
		poRef = obj("id", po.Get("id"), "po_number", orDashStr(po.Get("nomor_po"), po.Get("po_number")), "status", orEmpty(po.Get("status")))
	}
	return d.Set("supplier", supplierRef).Set("vendor", vendorRef).Set("purchase_order", poRef), nil
}

// orEmpty is `value || ""`.
func orEmpty(values ...any) any {
	for _, v := range values {
		if v != nil && v != "" {
			return v
		}
	}
	return ""
}

// updateDeliveryInput is updateDeliverySchema (nil = not sent).
type updateDeliveryInput struct {
	NoSuratJalan, Ekspedisi, NoResi              *string
	TanggalKirim, TanggalEstimasi, TanggalAktual *string
	Status, Catatan                              *string
}

// UpdateDelivery is updateDelivery.
func (s *Service) UpdateDelivery(ctx context.Context, id string, in *updateDeliveryInput, userID string) (*Row, error) {
	existing, err := s.deliveryOr404(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if in.Status != nil && *in.Status != existing.Str("status") {
		if msg := domain.DeliveryTransitionError(existing.Str("status"), *in.Status); msg != "" {
			return nil, badRequest(msg)
		}
	}
	w := newWhere()
	sets := []string{"updated_by = " + w.next(userID)}
	add := func(col string, v *string, cast string, ifTruthy bool) {
		if v == nil || (ifTruthy && *v == "") {
			return
		}
		sets = append(sets, col+" = "+w.next(*v)+cast)
	}
	add("no_surat_jalan", in.NoSuratJalan, "", true)
	add("kurir", in.Ekspedisi, "", false)
	add("no_resi", in.NoResi, "", false)
	add("tanggal_kirim", in.TanggalKirim, "::text::date", true)
	add("tanggal_estimasi_tiba", in.TanggalEstimasi, "::text::date", true)
	add("tanggal_aktual_tiba", in.TanggalAktual, "::text::date", true)
	add("status", in.Status, "", true)
	add("catatan", in.Catatan, "", false)
	return s.rows.One(ctx, s.db, `UPDATE deliveries SET `+strings.Join(sets, ", ")+` WHERE id = `+w.next(existing.Str("id"))+` RETURNING *`, w.args...)
}

// DeleteDelivery soft-deletes a pending or cancelled delivery.
func (s *Service) DeleteDelivery(ctx context.Context, id, userID string) error {
	existing, err := s.deliveryOr404(ctx, s.db, id)
	if err != nil {
		return err
	}
	if status := existing.Str("status"); status != domain.DeliveryPending && status != domain.DeliveryCancelled {
		return badRequest(`Delivery berstatus "` + jsString(existing.Get("status")) + `" — hanya delivery berstatus PENDING atau CANCELLED yang dapat dihapus`)
	}
	_, err = s.db.Exec(ctx, `UPDATE deliveries SET is_active = false, updated_by = $2 WHERE id = $1`, existing.Str("id"), userID)
	if err != nil {
		s.log.ErrorContext(ctx, "delete delivery", "error", err)
	}
	return nil
}

// ArriveDelivery is markDeliveryArrived: the delivery is marked delivered,
// then a pending GRN opens for it. As in the TS the two writes are separate:
// when the GRN insert fails the delivery is put back to in_transit and the
// request fails with a plain 500.
func (s *Service) ArriveDelivery(ctx context.Context, id, userID string, notes *string) (*Row, error) {
	delivery, err := s.deliveryOr404(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if msg := domain.DeliveryTransitionError(delivery.Str("status"), domain.DeliveryDelivered); msg != "" {
		return nil, badRequest(msg)
	}
	po, err := s.rows.One(ctx, s.db, `SELECT supplier_id, vendor_id, company_id, branch_id FROM purchase_orders WHERE id = $1`, delivery.Str("purchase_order_id"))
	if err != nil {
		return nil, err
	}
	if po == nil {
		po = newRow()
	}
	arrivedOn := s.now().UTC().Format("2006-01-02")
	updated, err := s.rows.One(ctx, s.db, `UPDATE deliveries SET status = 'delivered', tanggal_aktual_tiba = $2::text::date, updated_by = $3
		WHERE id = $1 RETURNING *`, delivery.Str("id"), arrivedOn, userID)
	if err != nil {
		return nil, err
	}
	var grn *Row
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		number, err := s.nextNumber(ctx, tx, "grn", "nomor_grn", domain.DailyPrefix("GRN", s.now().In(s.loc)))
		if err != nil {
			return err
		}
		grn, err = s.rows.One(ctx, tx, `INSERT INTO grn
			(nomor_grn, purchase_order_id, delivery_id, supplier_id, vendor_id, company_id, branch_id, tanggal_penerimaan,
			 penerima_id, status, catatan, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::date, $9, 'pending', $10, $9) RETURNING *`,
			number, delivery.Str("purchase_order_id"), delivery.Str("id"),
			firstNonNil(nonEmpty(delivery.StrPtr("supplier_id")), po.StrPtr("supplier_id")),
			firstNonNil(nonEmpty(delivery.StrPtr("vendor_id")), po.StrPtr("vendor_id")),
			firstNonNil(delivery.StrPtr("company_id"), po.StrPtr("company_id")), firstNonNil(delivery.StrPtr("branch_id"), po.StrPtr("branch_id")),
			arrivedOn, userID, nonEmpty(notes))
		return err
	})
	if err != nil {
		if _, rerr := s.db.Exec(ctx, `UPDATE deliveries SET status = 'in_transit', updated_by = $2 WHERE id = $1`, delivery.Str("id"), userID); rerr != nil {
			return nil, rerr
		}
		return nil, errors.New("Failed to create GRN: " + pgMessage(err))
	}
	return obj("delivery", updated, "grn", grn), nil
}

// PoOptionsForDelivery is listPoOptionsForDelivery.
func (s *Service) PoOptionsForDelivery(ctx context.Context, moduleType string, includeAssigned bool, scope *pscope.Scope) ([]*Row, error) {
	orders, err := s.rows.Query(ctx, s.db, `SELECT id, nomor_po, supplier_id, vendor_id, status, company_id, branch_id, created_at, module_type
		FROM purchase_orders WHERE is_active = true AND module_type = $1 AND status IN ('approved', 'sent', 'partially_received')
		ORDER BY created_at DESC LIMIT 500`, moduleType)
	if err != nil {
		return nil, err
	}
	parties := func(sql string, ids []string) (map[string]*Row, error) {
		out := map[string]*Row{}
		if len(ids) == 0 {
			return out, nil
		}
		rows, err := s.rows.Query(ctx, s.db, sql, ids)
		for _, r := range rows {
			out[r.Str("id")] = r
		}
		return out, err
	}
	suppliers, err := parties(`SELECT id, nama_supplier AS name, company_id, branch_id FROM suppliers WHERE id = ANY($1::uuid[])`, uniqueStrings(column(orders, "supplier_id")))
	if err != nil {
		return nil, err
	}
	vendors, err := parties(`SELECT id, name, company_id, branch_id FROM vendors WHERE id = ANY($1::uuid[])`, uniqueStrings(column(orders, "vendor_id")))
	if err != nil {
		return nil, err
	}
	partyField := func(m map[string]*Row, id, key string) *string {
		if r, ok := m[id]; ok {
			return r.StrPtr(key)
		}
		return nil
	}
	var scoped []*Row
	for _, po := range orders {
		company := firstNonNil(po.StrPtr("company_id"), partyField(suppliers, po.Str("supplier_id"), "company_id"), partyField(vendors, po.Str("vendor_id"), "company_id"))
		branch := firstNonNil(po.StrPtr("branch_id"), partyField(suppliers, po.Str("supplier_id"), "branch_id"), partyField(vendors, po.Str("vendor_id"), "branch_id"))
		if pscope.OperationalRowInScope(scope, company, branch) {
			scoped = append(scoped, po)
		}
	}
	if len(scoped) == 0 {
		return []*Row{}, nil
	}
	deliveries, err := s.rows.Query(ctx, s.db, `SELECT id, purchase_order_id, nomor_resi, no_surat_jalan, status FROM deliveries
		WHERE purchase_order_id = ANY($1::uuid[]) AND is_active = true AND status <> 'cancelled'`, column(scoped, "id"))
	if err != nil {
		return nil, err
	}
	byPo := map[string][]*Row{}
	for _, d := range deliveries {
		byPo[d.Str("purchase_order_id")] = append(byPo[d.Str("purchase_order_id")], d)
	}
	out := []*Row{}
	for _, po := range scoped {
		list := byPo[po.Str("id")]
		var open, latest *Row
		for _, d := range list {
			if domain.IsOpenDeliveryStatus(d.Str("status")) {
				open = d
				break
			}
		}
		if len(list) > 0 {
			latest = list[0]
		}
		if !includeAssigned && (!domain.IsPoStatusEligibleForDelivery(po.Str("status")) || open != nil) {
			continue
		}
		var party any
		if moduleType == "product" {
			if po.Str("vendor_id") != "" {
				party = partyNameOrNull(vendors, po.Str("vendor_id"))
			}
		} else if po.Str("supplier_id") != "" {
			party = partyNameOrNull(suppliers, po.Str("supplier_id"))
		}
		get := func(r *Row, key string) any {
			if r == nil {
				return nil
			}
			return r.Get(key)
		}
		var openID, openStatus any
		if open != nil {
			openID, openStatus = open.Get("id"), open.Get("status")
		}
		if openStatus == nil {
			openStatus = get(latest, "status")
		}
		number := jsOrValues(get(open, "nomor_resi"), get(open, "no_surat_jalan"), get(latest, "nomor_resi"), get(latest, "no_surat_jalan"))
		if number == "" {
			number = nil
		}
		out = append(out, obj("id", po.Get("id"), "nomor_po", po.Get("nomor_po"), "supplier_id", po.Get("supplier_id"),
			"vendor_id", po.Get("vendor_id"), "nama_supplier", party, "status", po.Get("status"),
			"active_delivery_id", openID, "active_delivery_number", number, "active_delivery_status", openStatus,
			"has_open_delivery", open != nil))
	}
	return out, nil
}

// partyNameOrNull is `(id && map.get(id)) ?? null` where a known id with an
// empty name stays "".
func partyNameOrNull(m map[string]*Row, id string) any {
	r, ok := m[id]
	if !ok {
		return nil
	}
	name := r.Get("name")
	if name == nil || name == "" {
		// `id && ""` is "" and `"" ?? null` keeps "".
		if name == "" {
			return ""
		}
		return nil
	}
	return name
}

// jsOrValues is `a || b || …`: the first truthy value, else the last.
func jsOrValues(values ...any) any {
	for _, v := range values {
		if v != nil && v != "" {
			return v
		}
	}
	return values[len(values)-1]
}

// DeliveriesForGrn is listDeliveriesForGrn.
func (s *Service) DeliveriesForGrn(ctx context.Context, moduleType string, scope *pscope.Scope) ([]*Row, error) {
	ids, err := s.poIDsByModule(ctx, s.db, moduleType)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []*Row{}, nil
	}
	w := newWhere().add("is_active = %s", true).add("status IN ('pending', 'shipped', 'in_transit', 'delivered')")
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("branch_id = %s::text::uuid", *b)
	}
	w.add("purchase_order_id = ANY(%s::uuid[])", ids)
	deliveries, err := s.rows.Query(ctx, s.db, `SELECT * FROM deliveries `+w.sql()+` ORDER BY created_at DESC LIMIT 200`, w.args...)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT delivery_id::text FROM grn WHERE is_active = true AND delivery_id IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	withGrn, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	has := map[string]bool{}
	for _, id := range withGrn {
		has[id] = true
	}
	var eligible []*Row
	for _, d := range deliveries {
		if !has[d.Str("id")] {
			eligible = append(eligible, d)
		}
	}
	suppliers, err := s.lookup(ctx, `SELECT id::text, nama_supplier FROM suppliers WHERE id = ANY($1::uuid[])`, uniqueStrings(column(eligible, "supplier_id")))
	if err != nil {
		return nil, err
	}
	vendors, err := s.lookup(ctx, `SELECT id::text, name FROM vendors WHERE id = ANY($1::uuid[])`, uniqueStrings(column(eligible, "vendor_id")))
	if err != nil {
		return nil, err
	}
	pos, err := s.lookup(ctx, `SELECT id::text, nomor_po FROM purchase_orders WHERE id = ANY($1::uuid[])`, uniqueStrings(column(eligible, "purchase_order_id")))
	if err != nil {
		return nil, err
	}
	out := make([]*Row, 0, len(eligible))
	for _, d := range eligible {
		// Missing names read as "-" in the lookup maps (`name || "-"`).
		name := func(m map[string]string, id string) any {
			if id == "" {
				return nil
			}
			v, ok := m[id]
			if !ok {
				return nil
			}
			if v == "" {
				return "-"
			}
			return v
		}
		vendorName := name(vendors, d.Str("vendor_id"))
		var vendorField any
		if d.Str("vendor_id") != "" {
			vendorField = vendorName
		}
		d.Set("po_id", d.Get("purchase_order_id"))
		d.Set("supplier_name", jsOrValues(name(suppliers, d.Str("supplier_id")), vendorName, d.Get("kurir"), "-"))
		d.Set("vendor_name", vendorField)
		d.Set("po_number", orDashStr(name(pos, d.Str("purchase_order_id"))))
		d.Set("delivery_number", jsOrValues(d.Get("nomor_resi"), d.Get("no_resi"), d.Get("no_surat_jalan"), d.Get("id")))
		out = append(out, d)
	}
	return out, nil
}

/* ── Receiving workspace ─────────────────────────────────────────────── */

// ReceivingWorkspace is loadReceivingWorkspace.
func (s *Service) ReceivingWorkspace(ctx context.Context, moduleType string) (any, error) {
	ids, err := s.poIDsByModule(ctx, s.db, moduleType)
	if err != nil {
		return nil, err
	}
	scopedPo := map[string]bool{}
	for _, id := range ids {
		scopedPo[id] = true
	}
	pos, err := s.rows.Query(ctx, s.db, `SELECT * FROM v_purchase_orders WHERE module_type = $1 ORDER BY created_at DESC LIMIT 200`, moduleType)
	if err != nil {
		return nil, err
	}
	deliveries, err := s.rows.Query(ctx, s.db, `SELECT * FROM deliveries WHERE is_active = true ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	grns, err := s.rows.Query(ctx, s.db, `SELECT * FROM grn WHERE is_active = true ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	keep := func(rows []*Row) []*Row {
		out := []*Row{}
		for _, r := range rows {
			if scopedPo[r.Str("purchase_order_id")] {
				out = append(out, r)
			}
		}
		return out
	}
	deliveries, grns = keep(deliveries), keep(grns)
	deliveryPo := map[string]bool{}
	var deliveryPoIDs []string
	for _, d := range deliveries {
		if id := d.Str("purchase_order_id"); id != "" && !deliveryPo[id] {
			deliveryPo[id] = true
			deliveryPoIDs = append(deliveryPoIDs, id)
		}
	}
	purchaseOrders := []*Row{}
	for _, po := range pos {
		if deliveryPo[po.Str("id")] {
			purchaseOrders = append(purchaseOrders, po)
		}
	}
	parties := append(append([]*Row{}, deliveries...), grns...)
	poNumbers, err := s.lookup(ctx, `SELECT id::text, nomor_po FROM purchase_orders WHERE id = ANY($1::uuid[])`, deliveryPoIDs)
	if err != nil {
		return nil, err
	}
	suppliers, err := s.lookup(ctx, `SELECT id::text, nama_supplier FROM suppliers WHERE id = ANY($1::uuid[])`, uniqueStrings(column(parties, "supplier_id")))
	if err != nil {
		return nil, err
	}
	vendors, err := s.lookup(ctx, `SELECT id::text, name FROM vendors WHERE id = ANY($1::uuid[])`, uniqueStrings(column(parties, "vendor_id")))
	if err != nil {
		return nil, err
	}
	partyName := func(r *Row) any {
		if v := suppliers[r.Str("supplier_id")]; v != "" {
			return v
		}
		if v := vendors[r.Str("vendor_id")]; v != "" {
			return v
		}
		return nil
	}
	poNumber := func(id string) any {
		if v := poNumbers[id]; v != "" {
			return v
		}
		return id
	}
	mappedDeliveries := make([]*Row, len(deliveries))
	deliveryNumber := map[string]any{}
	for i, d := range deliveries {
		noResi := jsOrValues(d.Get("no_resi"), d.Get("nomor_resi"))
		mappedDeliveries[i] = obj("id", d.Get("id"), "po_id", d.Get("purchase_order_id"), "po_number", poNumber(d.Str("purchase_order_id")),
			"supplier_name", partyName(d), "delivery_number", d.Get("nomor_resi"), "no_surat_jalan", d.Get("no_surat_jalan"),
			"ekspedisi", d.Get("kurir"), "no_resi", noResi, "tanggal_kirim", d.Get("tanggal_kirim"),
			"tanggal_estimasi_tiba", d.Get("tanggal_estimasi_tiba"), "tanggal_aktual_tiba", d.Get("tanggal_aktual_tiba"),
			"status", d.Get("status"), "created_at", d.Get("created_at"))
		deliveryNumber[d.Str("id")] = jsOrValues(noResi, d.Get("nomor_resi"), poNumber(d.Str("purchase_order_id")))
	}
	mappedGrns := make([]*Row, len(grns))
	for i, g := range grns {
		number := deliveryNumber[g.Str("delivery_id")]
		if number == nil || number == "" {
			number = g.Get("delivery_id")
		}
		mappedGrns[i] = obj("id", g.Get("id"), "nomor_grn", g.Get("nomor_grn"), "delivery_id", g.Get("delivery_id"),
			"delivery_number", number, "po_id", g.Get("purchase_order_id"), "po_number", poNumber(g.Str("purchase_order_id")),
			"supplier_id", g.Get("supplier_id"), "supplier_name", partyName(g), "tanggal_penerimaan", g.Get("tanggal_penerimaan"),
			"no_surat_jalan", g.Get("no_surat_jalan"), "status", g.Get("status"), "total_item_diterima", g.Get("total_item_diterima"),
			"total_item_ditolak", g.Get("total_item_ditolak"), "receive_count", intOr1(g.Get("receive_count")),
			"catatan", g.Get("catatan"), "created_at", g.Get("created_at"))
	}
	return struct {
		PurchaseOrders []*Row `json:"purchase_orders"`
		Deliveries     []*Row `json:"deliveries"`
		Grns           []*Row `json:"grns"`
	}{purchaseOrders, mappedDeliveries, mappedGrns}, nil
}
