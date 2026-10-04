package stock

import (
	"math"
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/validate"
)

// movementFilter is MovementFilter in stock-queries.ts.
type movementFilter struct {
	scope                            *ps.Scope
	rawMaterialID, warehouseID, tipe string
	referenceType, reference         string
	dateFrom, dateTo                 string
}

func (f movementFilter) where(a *kit.Args) string {
	where := []string{"m.is_active = true"}
	if f.rawMaterialID != "" {
		where = append(where, "m.raw_material_id = "+a.Add(f.rawMaterialID))
	}
	if f.warehouseID != "" {
		where = append(where, "m.warehouse_id = "+a.Add(f.warehouseID))
	}
	if f.tipe != "" {
		where = append(where, "m.tipe = "+a.Add(f.tipe))
	}
	if f.referenceType != "" {
		where = append(where, "m.reference_type = "+a.Add(f.referenceType))
	}
	if t := strings.TrimSpace(f.reference); t != "" {
		term := a.Add("%" + t + "%")
		where = append(where, "(m.reference_number ILIKE "+term+" OR m.reference_id::text ILIKE "+term+" OR rm.nama ILIKE "+term+" OR rm.kode ILIKE "+term+")")
	}
	if f.dateFrom != "" {
		where = append(where, "m.created_at >= "+a.Add(f.dateFrom)+"::date")
	}
	if f.dateTo != "" {
		where = append(where, "m.created_at < ("+a.Add(f.dateTo)+"::date + 1)")
	}
	if c := scopeClause(f.scope, "m.branch_id", a); c != "" {
		where = append(where, c)
	}
	return strings.Join(where, " AND ")
}

const movementSelect = `
  SELECT m.id, m.created_at::text AS created_at, m.raw_material_id,
         rm.kode AS material_kode, rm.nama AS material_nama,
         COALESCE(u_kecil.nama, u_besar.nama) AS satuan,
         m.warehouse_id, w.name AS warehouse_nama, m.tipe,
         CASE WHEN m.qty_after > m.qty_before THEN 'in'
              WHEN m.qty_after < m.qty_before THEN 'out' ELSE 'none' END AS direction,
         m.jumlah::float8 AS jumlah, m.qty_before::float8 AS qty_before, m.qty_after::float8 AS qty_after,
         m.unit_cost::float8 AS unit_cost, m.total_cost::float8 AS total_cost,
         m.reference_type, m.reference_number, m.reference_id::text AS reference_id,
         (SELECT string_agg(DISTINCT sb.batch_number, ', ')
            FROM inventory.stock_batch_movements sbm
            JOIN inventory.stock_batches sb ON sb.id = sbm.batch_id
           WHERE sbm.movement_id = m.id AND sb.batch_number IS NOT NULL) AS batch_numbers,
         m.alasan, u.full_name AS created_by_name
    FROM inventory.inventory_movements m
    JOIN item.raw_materials rm ON rm.id = m.raw_material_id
    LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
    LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
    LEFT JOIN configuration.warehouses w ON w.id = m.warehouse_id
    LEFT JOIN configuration.users u ON u.id = m.created_by`

// listMovements is listMovements: one page and the total.
func (h *handler) listMovements(r *http.Request, f movementFilter, limit, offset float64) (kit.Rows, int, error) {
	ctx := r.Context()
	a := &kit.Args{}
	where := f.where(a)
	var total string
	if err := h.env.DB.QueryRow(ctx, `SELECT COUNT(*)::text AS total
		FROM inventory.inventory_movements m JOIN item.raw_materials rm ON rm.id = m.raw_material_id
		WHERE `+where, a.Values...).Scan(&total); err != nil {
		return nil, 0, err
	}
	lim, off := a.Add(kit.N(limit)), a.Add(kit.N(offset))
	rows, err := kit.Query(ctx, h.env.DB, movementSelect+` WHERE `+where+` ORDER BY m.created_at DESC, m.id LIMIT `+lim+` OFFSET `+off, a.Values...)
	n, _ := strconv.Atoi(total)
	return rows, n, err
}

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var movementTipeLabels = map[string]string{
	"in": "Masuk", "out": "Keluar", "adjustment": "Penyesuaian", "transfer": "Transfer", "return": "Retur",
}

var movementReferenceLabels = map[string]string{
	"grn":               "Penerimaan (GRN)",
	"grn_delete":        "Pembatalan GRN",
	"adjustment":        "Penyesuaian manual",
	"stock_opname":      "Stok opname",
	"stock_transfer":    "Transfer stok",
	"scrap":             "Scrap / write-off",
	"production":        "Pemakaian produksi",
	"production_wip":    "Hasil produksi",
	"sales_realization": "Realisasi penjualan",
	"purchase_return":   "Retur pembelian",
	"import":            "Impor / saldo awal",
}

/* GET /api/inventory/movements — every material's movements; format=csv downloads. */
func (h *handler) movements(w http.ResponseWriter, r *http.Request) error {
	_, scope, err := h.staffScope(r, h.inventoryStaff)
	if err != nil {
		return err
	}
	q := kit.FromRequest(r, "", "all")
	rm := q.UUID("raw_material_id", validate.Rule{Optional: true})
	wh := q.UUID("warehouse_id", validate.Rule{Optional: true})
	tipe := q.Enum("tipe", validate.Rule{Optional: true}, []string{"in", "out", "adjustment", "transfer", "return"})
	refType := q.Str("reference_type", validate.Rule{Optional: true}, validate.StrOpts{Max: 50})
	ref := q.Str("reference", validate.Rule{Optional: true}, validate.StrOpts{Max: 100})
	dateCheck := validate.StrOpts{Check: kit.Pattern(isoDate, `/^\d{4}-\d{2}-\d{2}$/`)}
	dateFrom := q.Str("date_from", validate.Rule{Optional: true}, dateCheck)
	dateTo := q.Str("date_to", validate.Rule{Optional: true}, dateCheck)
	page := q.CoerceInt("page", 1, validate.NumOpts{Integer: true, Min: validate.Bound(1)})
	limit := q.CoerceInt("limit", 50, validate.NumOpts{Integer: true, Min: validate.Bound(1), Max: validate.Bound(200)})
	format := q.Str("format", validate.Rule{HasDefault: true}, validate.StrOpts{Check: validate.EnumCheck([]string{"json", "csv"})})
	if err := q.FlattenErr("Filter tidak valid"); err != nil {
		return err
	}
	f := movementFilter{
		scope: scope, rawMaterialID: kit.Deref(rm), warehouseID: kit.Deref(wh), tipe: kit.Deref(tipe),
		referenceType: kit.Deref(refType), reference: kit.Deref(ref), dateFrom: kit.Deref(dateFrom), dateTo: kit.Deref(dateTo),
	}

	if kit.Deref(format) == "csv" {
		a := &kit.Args{}
		rows, err := kit.Query(r.Context(), h.env.DB, movementSelect+` WHERE `+f.where(a)+` ORDER BY m.created_at DESC, m.id LIMIT 50000`, a.Values...)
		if err != nil {
			return err
		}
		stamp := kit.UTCDate(h.env.Now())
		body := "\ufeff" + movementsCSV(rows)
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="mutasi-stok-`+stamp+`.csv"`)
		w.WriteHeader(http.StatusOK)
		_, err = w.Write([]byte(body))
		return err
	}

	rows, total, err := h.listMovements(r, f, float64(limit), float64((page-1)*limit))
	if err != nil {
		return err
	}
	type meta struct {
		Page       int `json:"page"`
		Limit      int `json:"limit"`
		Total      int `json:"total"`
		TotalPages int `json:"totalPages"`
	}
	return kit.OK(w, struct {
		Success bool     `json:"success"`
		Data    kit.Rows `json:"data"`
		Meta    meta     `json:"meta"`
	}{true, rows, meta{page, limit, total, int(math.Ceil(float64(total) / float64(limit)))}})
}

// movementsCSV is convertToCSV(rows, CSV_COLUMNS) of the movements route.
func movementsCSV(rows kit.Rows) string {
	cols := []struct {
		key, label string
		format     func(any) string
	}{
		{"created_at", "Waktu", func(v any) string { s, _ := v.(string); return s[:min(len(s), 19)] }},
		{"material_kode", "Kode", nil},
		{"material_nama", "Bahan Baku", nil},
		{"warehouse_nama", "Gudang", nil},
		{"tipe", "Tipe", func(v any) string {
			s, _ := v.(string)
			if l, ok := movementTipeLabels[s]; ok {
				return l
			}
			return s
		}},
		{"jumlah", "Qty", nil},
		{"satuan", "Satuan", nil},
		{"qty_before", "Stok Sebelum", nil},
		{"qty_after", "Stok Sesudah", nil},
		{"unit_cost", "Biaya Satuan", nil},
		{"total_cost", "Total Biaya", nil},
		{"reference_type", "Sumber", func(v any) string {
			s, _ := v.(string)
			if s == "" {
				return "-"
			}
			if l, ok := movementReferenceLabels[s]; ok {
				return l
			}
			return s
		}},
		{"reference_number", "No. Referensi", nil},
		{"batch_numbers", "Batch", nil},
		{"alasan", "Keterangan", nil},
		{"created_by_name", "Oleh", nil},
	}
	var b strings.Builder
	for i, c := range cols {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`"` + c.label + `"`)
	}
	for _, row := range rows {
		b.WriteByte('\n')
		for i, c := range cols {
			if i > 0 {
				b.WriteByte(',')
			}
			v := row.Get(c.key)
			if c.format != nil {
				b.WriteString(`"` + c.format(v) + `"`)
				continue
			}
			b.WriteString(csvCell(v))
		}
	}
	return b.String()
}

// csvCell is csv-export.ts csvCell.
func csvCell(v any) string {
	switch x := v.(type) {
	case nil:
		return `""`
	case float64:
		return kit.JSNum(x)
	case int32:
		return strconv.Itoa(int(x))
	case string:
		return `"` + strings.ReplaceAll(x, `"`, `""`) + `"`
	}
	return `"` + strings.ReplaceAll(toString(v), `"`, `""`) + `"`
}

func toString(v any) string {
	if s, ok := v.(interface{ String() string }); ok {
		return s.String()
	}
	b, _ := kit.Obj("v", v).MarshalJSON()
	return strings.TrimSuffix(strings.TrimPrefix(string(b), `{"v":`), "}")
}
