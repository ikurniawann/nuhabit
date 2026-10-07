package procurement

import (
	"context"
	"encoding/json"
	"strings"

	pscope "nuhabit/backend/internal/platform/scope"
)

// Reads of grn_qc_inspections: GET /qc, /qc/[id] (lib/purchasing/
// qc-inspections.ts) and /grn/[id]/qc. The TS embeds grn, inspector and the
// inspection items; inspector is configuration.users, whose name column is
// full_name.

// qcEmbed lists the item and raw material columns a screen embeds.
type qcEmbed struct{ itemCols, materialCols string }

var (
	qcListEmbed = qcEmbed{"i.id, i.grn_item_id, i.raw_material_id, i.qty_inspected, i.qty_accepted, i.qty_rejected", "id, kode, nama"}
	grnQcEmbed  = qcEmbed{"i.id, i.grn_item_id, i.raw_material_id, i.qty_inspected, i.qty_accepted, i.qty_rejected, i.item_status, i.catatan", "id, nama, kode"}
)

const qcWithGrn = `q.*, (SELECT row_to_json(e) FROM (SELECT id, nomor_grn FROM purchasing.grn WHERE id = q.grn_id) e) AS grn`

// embedQc adds inspector {id, name, email} and items (each with
// raw_material) to inspection rows.
func (s *Service) embedQc(ctx context.Context, rows []*Row, e qcEmbed) error {
	users, err := s.ports.Directory.Users(ctx, s.db, uniqueStrings(column(rows, "inspector_id")))
	if err != nil {
		return err
	}
	list, err := s.rows.Query(ctx, s.db, `SELECT i.qc_inspection_id::text AS qc, (SELECT row_to_json(e) FROM (SELECT `+e.itemCols+`) e) AS item
		FROM grn_qc_inspection_items i WHERE i.qc_inspection_id = ANY($1::uuid[]) ORDER BY i.created_at, i.id`, column(rows, "id"))
	if err != nil {
		return err
	}
	items := make([]*Row, len(list))
	for i, it := range list {
		raw, _ := it.Get("item").(json.RawMessage)
		if items[i], err = decodeRow(raw); err != nil {
			return err
		}
	}
	materials, err := s.ports.Catalog.Refs(ctx, s.db, EntityRawMaterial, e.materialCols, uniqueStrings(column(items, "raw_material_id")))
	if err != nil {
		return err
	}
	byInspection := map[string][]*Row{}
	for i, it := range list {
		item := items[i].Set("raw_material", refOrNull(materials, items[i].Str("raw_material_id")))
		byInspection[it.Str("qc")] = append(byInspection[it.Str("qc")], item)
	}
	for _, r := range rows {
		var inspector any
		if u, ok := users[r.Str("inspector_id")]; ok {
			inspector = obj("id", u.ID, "name", u.FullName, "email", u.Email)
		}
		r.Set("inspector", inspector)
		list := byInspection[r.Str("id")]
		if list == nil {
			list = []*Row{}
		}
		r.Set("items", list)
	}
	return nil
}

// QcListParams is the GET /qc query.
type QcListParams struct {
	Page, Limit float64
	Search      string
}

// ListQcInspections is GET /qc: newest first, scoped and searched by GRN.
func (s *Service) ListQcInspections(ctx context.Context, p QcListParams, scope *pscope.Scope) ([]*Row, int, error) {
	w := newWhere()
	if c := pscope.CompanyFilter(scope); c != nil {
		w.add("g.company_id = %s::text::uuid", *c)
	}
	if b := pscope.BranchFilter(scope); b != nil {
		w.add("g.branch_id = %s::text::uuid", *b)
	}
	if p.Search != "" {
		w.add("g.nomor_grn ILIKE %s", strings.ReplaceAll("%"+p.Search+"%", "*", "%"))
	}
	from := ` FROM grn_qc_inspections q JOIN grn g ON g.id = q.grn_id ` + w.sql()
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int`+from, w.args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	limit, offset := w.next(formatJSNumber(p.Limit)), w.next(formatJSNumber((p.Page-1)*p.Limit))
	rows, err := s.rows.Query(ctx, s.db, `SELECT `+qcWithGrn+from+` ORDER BY q.created_at DESC LIMIT `+limit+`::text::bigint OFFSET `+offset+`::text::bigint`, w.args...)
	if err != nil {
		return nil, 0, err
	}
	if err := s.embedQc(ctx, rows, qcListEmbed); err != nil {
		return nil, 0, err
	}
	out := make([]*Row, len(rows))
	for i, r := range rows {
		out[i] = qcListRow(r)
	}
	return out, total, nil
}

// QcInspection is GET /qc/[id]; nil when missing.
func (s *Service) QcInspection(ctx context.Context, id string) (*Row, error) {
	r, err := s.rows.One(ctx, s.db, `SELECT `+qcWithGrn+` FROM grn_qc_inspections q WHERE q.id = $1::text::uuid`, id)
	if err != nil || r == nil {
		return nil, err
	}
	if err := s.embedQc(ctx, []*Row{r}, qcListEmbed); err != nil {
		return nil, err
	}
	return qcDetail(r), nil
}

// GrnQcInspection is GET /grn/[id]/qc; nil when the GRN has no inspection.
func (s *Service) GrnQcInspection(ctx context.Context, grnID string) (*Row, error) {
	r, err := s.rows.One(ctx, s.db, `SELECT * FROM grn_qc_inspections WHERE grn_id = $1::text::uuid`, grnID)
	if err != nil || r == nil {
		return nil, err
	}
	return r, s.embedQc(ctx, []*Row{r}, grnQcEmbed)
}

func mapQcStatus(status string) string {
	switch status {
	case "approved":
		return "APPROVED"
	case "rejected":
		return "REJECTED"
	}
	return "PARTIAL"
}

func mapQcRecommendation(status string) string {
	switch status {
	case "approved":
		return "ACCEPT"
	case "rejected":
		return "REJECT"
	}
	return "REWORK"
}

// qcSummary is summarizeInspection; grn and firstItem are nil when the TS
// reads undefined, and their fields are then left out.
type qcSummary struct {
	grn, firstItem                *Row
	inspected, accepted, rejected float64
	inspectedAt                   any
	status, recommending          string
}

func summarizeQc(r *Row) qcSummary {
	sum := qcSummary{status: mapQcStatus(r.Str("status")), recommending: mapQcRecommendation(r.Str("status"))}
	if raw, ok := r.Get("grn").(json.RawMessage); ok {
		sum.grn, _ = decodeRow(raw)
	}
	items, _ := r.Get("items").([]*Row)
	if len(items) > 0 {
		sum.firstItem = items[0]
	}
	for _, it := range items {
		sum.inspected += it.Num("qty_inspected")
		sum.accepted += it.Num("qty_accepted")
		sum.rejected += it.Num("qty_rejected")
	}
	sum.inspectedAt = r.Get("inspected_at")
	if sum.inspectedAt == nil {
		sum.inspectedAt = r.Get("created_at")
	}
	return sum
}

// setGrnAndMaterial writes grn_number and bahan_baku_id when the TS has them.
func (q qcSummary) setGrnAndMaterial(out *Row) {
	if q.grn != nil {
		out.Set("grn_number", q.grn.Get("nomor_grn"))
	}
	if q.firstItem != nil {
		out.Set("bahan_baku_id", q.firstItem.Get("raw_material_id"))
	}
}

// qcListRow is mapQcListRow.
func qcListRow(r *Row) *Row {
	sum := summarizeQc(r)
	out := obj("id", r.Get("id"), "qc_number", r.Get("id"), "goods_receipt_id", r.Get("grn_id"), "grn_id", r.Get("grn_id"))
	sum.setGrnAndMaterial(out)
	out.Set("jumlah_diperiksa", sum.inspected).Set("jumlah_diterima", sum.accepted).Set("jumlah_ditolak", sum.rejected).
		Set("hasil", r.Get("status")).Set("parameter_inspeksi", r.Get("parameter_inspeksi")).Set("catatan", r.Get("catatan")).
		Set("inspector_id", r.Get("inspector_id")).Set("inspector", r.Get("inspector")).Set("tanggal_inspeksi", sum.inspectedAt).
		Set("created_at", r.Get("created_at")).Set("status", sum.status).Set("rekomendasi", sum.recommending)
	items, _ := r.Get("items").([]*Row)
	mapped := make([]*Row, len(items))
	for i, it := range items {
		mapped[i] = obj("bahan_baku_id", it.Get("raw_material_id"), "raw_material_id", it.Get("raw_material_id"),
			"jumlah_diperiksa", it.Get("qty_inspected"), "jumlah_diterima", it.Get("qty_accepted"),
			"jumlah_ditolak", it.Get("qty_rejected"), "raw_material", it.Get("raw_material"))
	}
	return out.Set("items", mapped)
}

// qcDetail is mapQcDetail: the row plus the summary, status and
// rekomendasi replaced in place.
func qcDetail(r *Row) *Row {
	sum := summarizeQc(r)
	r.Set("qc_number", r.Get("id")).Set("goods_receipt_id", r.Get("grn_id"))
	sum.setGrnAndMaterial(r)
	if sum.firstItem != nil {
		r.Set("bahan_baku", sum.firstItem.Get("raw_material"))
	}
	return r.Set("jumlah_diperiksa", sum.inspected).Set("jumlah_diterima", sum.accepted).Set("jumlah_ditolak", sum.rejected).
		Set("tanggal_inspeksi", sum.inspectedAt).Set("status", sum.status).Set("rekomendasi", sum.recommending)
}
