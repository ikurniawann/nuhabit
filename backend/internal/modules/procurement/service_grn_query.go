package procurement

import (
	"context"
	"encoding/json"
	"strings"

	pscope "nuhabit/backend/internal/platform/scope"
)

// GrnListParams is grnListQuerySchema.
type GrnListParams struct {
	Page, Limit                      float64
	Search, Status, DeliveryID, PoID *string
	DateFrom, DateTo                 *string
}

// ListGrns is listGrns.
func (s *Service) ListGrns(ctx context.Context, p GrnListParams, scope *pscope.Scope) ([]*Row, int, error) {
	w := newWhere().add("is_active = %s", true)
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("branch_id = %s::text::uuid", *b)
	}
	if set(p.Status) {
		w.add("status = %s", *p.Status)
	}
	if set(p.DeliveryID) {
		w.add("delivery_id = %s::text::uuid", *p.DeliveryID)
	}
	if set(p.PoID) {
		w.add("purchase_order_id = %s::text::uuid", *p.PoID)
	}
	if set(p.DateFrom) {
		w.add("tanggal_penerimaan >= %s::text::date", *p.DateFrom)
	}
	if set(p.DateTo) {
		w.add("tanggal_penerimaan <= %s::text::date", *p.DateTo)
	}
	if set(p.Search) {
		pattern := strings.ReplaceAll("%"+*p.Search+"%", "*", "%")
		w.add("(nomor_grn ILIKE %s OR no_surat_jalan ILIKE %s)", pattern, pattern)
	}
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM grn `+w.sql(), w.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	limit, offset := w.next(formatJSNumber(p.Limit)), w.next(formatJSNumber((p.Page-1)*p.Limit))
	rows, err := s.rows.Query(ctx, s.db, `SELECT * FROM grn `+w.sql()+` ORDER BY created_at DESC LIMIT `+limit+`::text::bigint OFFSET `+offset+`::text::bigint`, w.args...)
	if err != nil {
		return nil, 0, err
	}
	deliveries, err := s.lookup(ctx, `SELECT id::text, COALESCE(NULLIF(no_resi, ''), nomor_resi) FROM deliveries WHERE id = ANY($1::uuid[])`, uniqueStrings(column(rows, "delivery_id")))
	if err != nil {
		return nil, 0, err
	}
	pos, err := s.lookup(ctx, `SELECT id::text, nomor_po FROM purchase_orders WHERE id = ANY($1::uuid[])`, uniqueStrings(column(rows, "purchase_order_id")))
	if err != nil {
		return nil, 0, err
	}
	suppliers, err := s.lookup(ctx, `SELECT id::text, nama_supplier FROM suppliers WHERE id = ANY($1::uuid[])`, uniqueStrings(column(rows, "supplier_id")))
	if err != nil {
		return nil, 0, err
	}
	out := make([]*Row, len(rows))
	for i, r := range rows {
		out[i] = obj(
			"id", r.Get("id"), "nomor_grn", r.Get("nomor_grn"),
			"delivery_id", r.Get("delivery_id"), "delivery_number", orID(deliveries, r, "delivery_id"),
			"po_id", r.Get("purchase_order_id"), "po_number", orID(pos, r, "purchase_order_id"),
			"supplier_id", r.Get("supplier_id"), "supplier_name", orDash(suppliers, r.Str("supplier_id")),
			"tanggal_penerimaan", r.Get("tanggal_penerimaan"), "no_surat_jalan", r.Get("no_surat_jalan"),
			"status", r.Get("status"), "total_item_diterima", r.Get("total_item_diterima"),
			"total_item_ditolak", r.Get("total_item_ditolak"), "receive_count", intOr1(r.Get("receive_count")),
			"catatan", r.Get("catatan"), "created_at", r.Get("created_at"))
	}
	return out, total, nil
}

// orID is `(id && map.get(id)) || id`.
func orID(m map[string]string, r *Row, key string) any {
	if v := m[r.Str(key)]; v != "" {
		return v
	}
	return r.Get(key)
}

func orDash(m map[string]string, id string) string {
	if v := m[id]; v != "" {
		return v
	}
	return "—"
}

// GrnDetail is getGrnDetail.
func (s *Service) GrnDetail(ctx context.Context, id string) (*Row, error) {
	grn, err := s.rows.One(ctx, s.db, `SELECT * FROM grn WHERE id = $1::text::uuid AND is_active = true`, id)
	if err != nil || grn == nil {
		return nil, notFound("GRN tidak ditemukan")
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT id, grn_id, delivery_id, purchase_order_item_id, raw_material_id, pos_sku_id,
		qty_diterima, qty_ditolak, kondisi, catatan, satuan_id, batch_number, expiry_date, is_active, created_at, updated_at,
		(SELECT row_to_json(e) FROM (SELECT id, qty_ordered, qty_received, harga_satuan, subtotal, satuan_id
		   FROM purchasing.purchase_order_items WHERE id = grn_items.purchase_order_item_id) e) AS purchase_order_item
		FROM grn_items WHERE grn_id = $1 AND is_active = true`, grn.Str("id"))
	if err != nil {
		return nil, serverMessage(err, "Gagal memuat item penerimaan")
	}
	if err := s.embedGrnDetailRefs(ctx, items); err != nil {
		return nil, err
	}

	var delivery, po, supplier *Row
	if d := grn.Str("delivery_id"); d != "" {
		delivery, _ = s.rows.One(ctx, s.db, `SELECT * FROM deliveries WHERE id = $1`, d)
	}
	if p := grn.Str("purchase_order_id"); p != "" {
		po, _ = s.rows.One(ctx, s.db, `SELECT id, nomor_po, status, tanggal_po, total FROM purchase_orders WHERE id = $1`, p)
	}
	if sup := grn.Str("supplier_id"); sup != "" {
		supplier, _ = s.rows.One(ctx, s.db, `SELECT id, nama_supplier, kode, email, telepon FROM suppliers WHERE id = $1`, sup)
	}
	if delivery != nil {
		grn.Set("delivery_number", jsOr(delivery, "no_resi", "nomor_resi", "no_surat_jalan"))
	}
	grn.Set("delivery", rowOrNull(delivery))
	grn.Set("purchase_order", rowOrNull(po))
	if po != nil {
		grn.Set("po_number", po.Get("nomor_po"))
		grn.Set("po_status", po.Get("status"))
	}
	if supplier != nil {
		grn.Set("supplier_name", supplier.Get("nama_supplier"))
	}
	grn.Set("supplier", rowOrNull(supplier))
	grn.Set("items", items)
	return grn, nil
}

// jsOr is `r.a || r.b || r.c`: the first truthy value, else the last one.
func jsOr(r *Row, keys ...string) any {
	for _, k := range keys {
		if v := r.Get(k); v != nil && v != "" {
			return v
		}
	}
	return r.Get(keys[len(keys)-1])
}

func rowOrNull(r *Row) any {
	if r == nil {
		return nil
	}
	return r
}

// embedGrnDetailRefs adds raw_material (with satuan_besar), satuan, pos_sku
// and the nested purchase_order_item.satuan, in GRN_ITEM_DETAIL_SELECT order.
func (s *Service) embedGrnDetailRefs(ctx context.Context, items []*Row) error {
	materials, err := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, "id, nama, kode, satuan_besar_id", uniqueStrings(column(items, "raw_material_id")))
	if err != nil {
		return err
	}
	poItems := make([]*Row, len(items))
	unitIDs := column(items, "satuan_id")
	parsed := map[string]*Row{}
	for _, raw := range materials {
		rm, err := decodeRow(raw)
		if err != nil {
			return err
		}
		parsed[rm.Str("id")] = rm
		unitIDs = append(unitIDs, rm.Str("satuan_besar_id"))
	}
	for i, item := range items {
		if raw, ok := item.Get("purchase_order_item").(json.RawMessage); ok {
			if poItems[i], err = decodeRow(raw); err != nil {
				return err
			}
			unitIDs = append(unitIDs, poItems[i].Str("satuan_id"))
		}
	}
	units, err := s.ports.Catalog.Refs(ctx, s.db, EntityUnit, "id, nama, kode", uniqueStrings(unitIDs))
	if err != nil {
		return err
	}
	skus, err := s.ports.Catalog.Refs(ctx, s.db, EntityPosSku, "id, sku, name", uniqueStrings(column(items, "pos_sku_id")))
	if err != nil {
		return err
	}
	for i, item := range items {
		var rm any
		if m, ok := parsed[item.Str("raw_material_id")]; ok {
			rm = obj("id", m.Get("id"), "nama", m.Get("nama"), "kode", m.Get("kode"), "satuan_besar", refOrNull(units, m.Str("satuan_besar_id")))
		}
		var poItem any
		if p := poItems[i]; p != nil {
			poItem = obj("id", p.Get("id"), "qty_ordered", p.Get("qty_ordered"), "qty_received", p.Get("qty_received"),
				"harga_satuan", p.Get("harga_satuan"), "subtotal", p.Get("subtotal"), "satuan", refOrNull(units, p.Str("satuan_id")))
		}
		item.Set("raw_material", rm)
		item.Set("satuan", refOrNull(units, item.Str("satuan_id")))
		item.Set("pos_sku", refOrNull(skus, item.Str("pos_sku_id")))
		item.Set("purchase_order_item", poItem)
	}
	return nil
}

/* ── Receiving rules on the database ─────────────────────────────────── */
