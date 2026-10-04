package production

import (
	"context"
	"net/http"
	"regexp"
	"slices"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Additional purchase costs (freight, duty, handling, ...) on a PO or GRN in
// purchasing.cogs_additional_costs: lib/purchasing/cogs-additional-cost.ts.
// They are allocated to received raw materials by value when COGS is
// estimated (domain.LandedCostRates); nothing is stored per line.

var (
	costReferenceTypes = []string{"PO", "GRN"}
	costTypes          = []string{"freight", "duty", "handling", "asuransi", "loading", "lainnya"}
	isoDate            = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

const additionalCostSelect = `SELECT c.id, c.reference_type, c.reference_id, c.tipe_biaya, c.deskripsi, c.jumlah, c.currency,
       c.exchange_rate, c.jumlah_idr, c.tanggal_transaksi::text AS tanggal_transaksi, c.catatan, c.created_at,
       u.full_name AS created_by_name
  FROM purchasing.cogs_additional_costs c
  LEFT JOIN configuration.users u ON u.id = c.created_by
 WHERE c.is_active = true`

// additionalCosts reads active costs matching where (ANDed) with their
// document numbers, newest transaction first.
func (h *handler) additionalCosts(ctx context.Context, a *kit.Args, where []string) ([]*kit.Row, error) {
	sql := additionalCostSelect
	for _, w := range where {
		sql += " AND " + w
	}
	rows, err := kit.Query(ctx, h.env.DB, sql+` ORDER BY c.tanggal_transaksi DESC, c.created_at DESC`, a.Values...)
	if err != nil || len(rows) == 0 {
		return []*kit.Row{}, err
	}
	refs := make([]DocRef, len(rows))
	for i, r := range rows {
		refs[i] = DocRef{r.Str("reference_type"), r.Str("reference_id")}
	}
	numbers, err := h.ports.Receipts.DocumentNumbers(ctx, h.env.DB, refs)
	if err != nil {
		return nil, err
	}
	out := make([]*kit.Row, len(rows))
	for i, r := range rows {
		var number any
		if n, ok := numbers[domain.DocKey(refs[i].Type, refs[i].ID)]; ok {
			number = n
		}
		out[i] = kit.Obj("id", r.Get("id"), "reference_type", r.Get("reference_type"), "reference_id", r.Get("reference_id"),
			"reference_number", number, "tipe_biaya", r.Get("tipe_biaya"), "deskripsi", r.Get("deskripsi"), "jumlah", r.Get("jumlah"),
			"currency", r.Get("currency"), "exchange_rate", r.Get("exchange_rate"), "jumlah_idr", r.Get("jumlah_idr"),
			"tanggal_transaksi", r.Get("tanggal_transaksi"), "catatan", r.Get("catatan"), "created_at", r.Get("created_at"),
			"created_by_name", r.Get("created_by_name"))
	}
	return out, nil
}

/* GET /api/purchasing/cogs/additional-cost?reference_type=&reference_id=&tipe_biaya= */
func (h *handler) listAdditionalCosts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.itemsStaff(r); err != nil {
		return err
	}
	q := r.URL.Query()
	a := &kit.Args{}
	var where []string
	if v := q.Get("reference_type"); v != "" {
		if !slices.Contains(costReferenceTypes, v) {
			return httpx.BadRequest("reference_type tidak valid")
		}
		where = append(where, "c.reference_type = "+a.Add(v))
	}
	if v := q.Get("reference_id"); v != "" {
		if !validate.IsUUID(v) {
			return httpx.BadRequest("reference_id tidak valid")
		}
		where = append(where, "c.reference_id = "+a.Add(v)+"::uuid")
	}
	if v := q.Get("tipe_biaya"); v != "" {
		where = append(where, "c.tipe_biaya = "+a.Add(v))
	}
	rows, err := h.additionalCosts(r.Context(), a, where)
	if err != nil {
		return err
	}
	return kit.OK(w, kit.Obj("success", true, "data", rows, "pagination", kit.Obj("total", len(rows))))
}

/* POST /api/purchasing/cogs/additional-cost */
func (h *handler) createAdditionalCost(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	refType := kit.Enum(f, "reference_type", validate.Rule{}, costReferenceTypes, "")
	refID := f.UUID("reference_id", validate.Rule{})
	costType := kit.Enum(f, "tipe_biaya", validate.Rule{}, costTypes, "")
	amount := kit.NumCheck(f, "jumlah", validate.Rule{}, positive("Jumlah harus positif"))
	currency := f.StrDefault("currency", "IDR", validate.StrOpts{Min: 3, Max: 3})
	rate := kit.NumCheck(f, "exchange_rate", validate.Rule{HasDefault: true}, positive("Kurs harus positif"))
	description := f.Str("deskripsi", validate.Rule{Optional: true}, validate.StrOpts{})
	date := f.Str("tanggal_transaksi", validate.Rule{Optional: true}, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Format tanggal harus YYYY-MM-DD", isoDate.MatchString(s)
	}})
	notes := f.Str("catatan", validate.Rule{Optional: true}, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	ref := DocRef{*refType, *refID}
	numbers, err := h.ports.Receipts.DocumentNumbers(ctx, h.env.DB, []DocRef{ref})
	if err != nil {
		return err
	}
	if _, ok := numbers[domain.DocKey(ref.Type, ref.ID)]; !ok {
		return httpx.NotFound(ref.Type + " tidak ditemukan")
	}
	exchange := 1.0
	if rate != nil {
		exchange = *rate
	}
	var id string
	if err := h.env.DB.QueryRow(ctx, `INSERT INTO purchasing.cogs_additional_costs (reference_type, reference_id, tipe_biaya, deskripsi,
		jumlah, currency, exchange_rate, jumlah_idr, tanggal_transaksi, catatan, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, CURRENT_DATE), $10, $11, $11) RETURNING id::text`,
		ref.Type, ref.ID, *costType, description, *amount, currency, exchange, domain.LandedCostIDR(*amount, exchange), date, notes, u.ID,
	).Scan(&id); err != nil {
		return err
	}
	a := &kit.Args{}
	rows, err := h.additionalCosts(ctx, a, []string{"c.id = " + a.Add(id) + "::uuid"})
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, kit.Obj("success", true, "data", rows[0], "message", "Biaya tambahan berhasil ditambahkan"))
}

/* DELETE /api/purchasing/cogs/additional-cost/{id} — soft delete. */
func (h *handler) deleteAdditionalCost(w http.ResponseWriter, r *http.Request) error {
	u, err := h.itemsStaff(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	notFound := httpx.NotFound("Biaya tambahan tidak ditemukan")
	if !validate.IsUUID(id) {
		return notFound
	}
	tag, err := h.env.DB.Exec(r.Context(), `UPDATE purchasing.cogs_additional_costs SET is_active = false, updated_by = $2
		WHERE id = $1 AND is_active = true`, id, u.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return notFound
	}
	return kit.OK(w, kit.Obj("success", true, "data", nil, "message", "Biaya tambahan berhasil dihapus"))
}

// landedRates is each BOM material's landed cost rate from the active
// additional costs on the documents that received it.
func (h *handler) landedRates(ctx context.Context, lines []cogsLine) (map[string]float64, error) {
	ids := materialIDs(lines)
	if len(ids) == 0 {
		return nil, nil
	}
	receipts, totals, err := h.ports.Receipts.ReceivedValues(ctx, h.env.DB, ids)
	if err != nil || len(receipts) == 0 {
		return nil, err
	}
	var grns, pos []string
	for _, l := range receipts {
		grns = append(grns, l.GrnID)
		pos = append(pos, l.PoID)
	}
	rows, err := kit.Query(ctx, h.env.DB, `SELECT reference_type, reference_id::text AS reference_id,
		COALESCE(jumlah_idr, round(jumlah * COALESCE(exchange_rate, 1), 2))::float8 AS amount
		FROM purchasing.cogs_additional_costs
		WHERE is_active = true AND ((reference_type = 'GRN' AND reference_id = ANY($1::uuid[]))
		   OR (reference_type = 'PO' AND reference_id = ANY($2::uuid[])))`, grns, pos)
	if err != nil {
		return nil, err
	}
	costs := make([]domain.LandedCost, len(rows))
	for i, c := range rows {
		costs[i] = domain.LandedCost{RefType: c.Str("reference_type"), RefID: c.Str("reference_id"), Amount: c.Num("amount")}
	}
	return domain.LandedCostRates(costs, receipts, totals), nil
}
