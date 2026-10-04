package procurement

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// fatalSince reports whether an issue zod treats as aborting (a type
// mismatch, not a failed check) was recorded at or after start: zod v4
// skips an object's superRefine when its subtree has one.
func fatalSince(f *validate.Form, start int) bool {
	for _, is := range f.Issues()[start:] {
		switch is.Code {
		case "invalid_type", "invalid_value", "invalid_union":
			return true
		}
	}
	return false
}

// batchFields are grnBatchFields: batch_number (trimmed, ≤100) and
// expiry_date (YYYY-MM-DD), both optional and nullable.
func batchFields(f *validate.Form) (batch, expiry *string) {
	batch = f.Str("batch_number", optionalNullable, validate.StrOpts{Trim: true, Check: func(s string) (string, string, bool) {
		return "too_big", "Nomor batch maksimal 100 karakter", validate.UTF16Len(s) <= 100
	}})
	expiry = f.Str("expiry_date", optionalNullable, isoDateCheck("Format tanggal kedaluwarsa YYYY-MM-DD"))
	return
}

// grnLineInput is one createGrnSchema item.
type grnLineInput struct {
	DeliveryID, PurchaseOrderItemID, RawMaterialID, ProductID, SupplyItemID *string
	PosSkuID                                                                *string
	QtyDiterima, QtyDitolak                                                 float64
	QtyAccepted, QtyRejected                                                *float64
	SatuanID                                                                *string
	Kondisi                                                                 string
	Catatan                                                                 *string
	BatchNumber, ExpiryDate                                                 *string
}

func (l grnLineInput) receive() domain.ReceiveLine {
	return domain.ReceiveLine{
		PurchaseOrderItemID: deref(l.PurchaseOrderItemID), RawMaterialID: deref(l.RawMaterialID),
		ProductID: deref(l.ProductID), SupplyItemID: deref(l.SupplyItemID), PosSkuID: l.PosSkuID,
		QtyDiterima: l.QtyDiterima, QtyDitolak: l.QtyDitolak,
	}
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// createGrnInput is createGrnSchema.
type createGrnInput struct {
	DeliveryID, PoID  *string
	ModuleType        *string
	TanggalPenerimaan *string
	Catatan           *string
	WarehouseID       string
	Items             []grnLineInput
}

var kondisiOptions = []string{"baik", "rusak", "cacat"}

func parseCreateGrn(f *validate.Form) (*createGrnInput, error) {
	in := &createGrnInput{}
	start := len(f.Issues())
	in.DeliveryID = f.Str("delivery_id", optional, uuidOpts)
	in.PoID = f.Str("po_id", optional, uuidOpts)
	in.ModuleType = enumField(f, "module_type", optional, []string{"raw_material", "product", "general"})
	in.TanggalPenerimaan = f.Str("tanggal_penerimaan", optional, validate.StrOpts{})
	in.Catatan = f.Str("catatan", optional, validate.StrOpts{})
	if w := f.Str("warehouse_id", validate.Rule{}, uuidMsg("Gudang wajib dipilih")); w != nil {
		in.WarehouseID = *w
	}
	listMin1(f, "items", "Minimal 1 item wajib diisi", func(items *validate.Form, i int, v any) {
		itemStart := len(f.Issues())
		item := items.Item(i, v)
		l := grnLineInput{Kondisi: "baik"}
		l.DeliveryID = item.Str("delivery_id", optional, uuidOpts)
		l.PurchaseOrderItemID = item.Str("purchase_order_item_id", optional, uuidOpts)
		l.RawMaterialID = item.Str("raw_material_id", optional, uuidOpts)
		l.ProductID = item.Str("product_id", optional, uuidOpts)
		l.SupplyItemID = item.Str("supply_item_id", optional, uuidOpts)
		l.PosSkuID = item.Str("pos_sku_id", optionalNullable, uuidOpts)
		if q := numberMsg(item, "qty_diterima", validate.Rule{}, 0, "Qty diterima minimal 0"); q != nil {
			l.QtyDiterima = *q
		}
		if q := numberMsg(item, "qty_ditolak", validate.Rule{}, 0, "Qty ditolak minimal 0"); q != nil {
			l.QtyDitolak = *q
		}
		l.QtyAccepted = item.Num("qty_accepted", optional, nonNegative)
		l.QtyRejected = item.Num("qty_rejected", optional, nonNegative)
		l.SatuanID = item.Str("satuan_id", optional, uuidOpts)
		if k := enumField(item, "kondisi", validate.Rule{HasDefault: true}, kondisiOptions); k != nil {
			l.Kondisi = *k
		}
		l.Catatan = item.Str("catatan", optionalNullable, validate.StrOpts{})
		l.BatchNumber, l.ExpiryDate = batchFields(item)
		if !fatalSince(f, itemStart) && deref(l.RawMaterialID) == "" && deref(l.ProductID) == "" && deref(l.SupplyItemID) == "" {
			item.Fail("supply_item_id", "custom", "Item wajib memiliki raw material, product, atau barang operasional")
		}
		in.Items = append(in.Items, l)
	})
	if !fatalSince(f, start) {
		if deref(in.DeliveryID) == "" && deref(in.PoID) == "" {
			f.Fail("delivery_id", "custom", "Delivery atau purchase order wajib dipilih")
		}
		if in.ModuleType == nil || *in.ModuleType != "general" {
			for i, item := range in.Items {
				if item.QtyDiterima <= 0 {
					continue
				}
				accepted, rejected := item.QtyDiterima, 0.0
				if item.QtyAccepted != nil {
					accepted = *item.QtyAccepted
				}
				if item.QtyRejected != nil {
					rejected = *item.QtyRejected
				}
				if math.Abs(accepted+rejected-item.QtyDiterima) > domain.GrnQtyEpsilon {
					f.Fail("items", "custom", "Qty QC accepted + rejected harus sama dengan qty diterima")
					fixPath(f, i)
				}
			}
		}
	}
	return in, f.Err("Validation failed")
}

// fixPath points the last issue at items.<i>.qty_accepted.
func fixPath(f *validate.Form, i int) {
	issues := f.Issues()
	issues[len(issues)-1].Path = []any{"items", i, "qty_accepted"}
}

// updateGrnLine is one updateGrnSchema item.
type updateGrnLine struct {
	PurchaseOrderItemID     *string
	RawMaterialID           string
	QtyDiterima, QtyDitolak float64
	Kondisi                 string
	Catatan                 *string
	BatchNumber, ExpiryDate *string
}

func (l updateGrnLine) receive() domain.ReceiveLine {
	return domain.ReceiveLine{PurchaseOrderItemID: deref(l.PurchaseOrderItemID), RawMaterialID: l.RawMaterialID,
		QtyDiterima: l.QtyDiterima, QtyDitolak: l.QtyDitolak}
}

// updateGrnInput is updateGrnSchema; Catatan is set when sent.
type updateGrnInput struct {
	Status            *string
	Catatan           *string
	Items             []updateGrnLine
	HasItems          bool
	TanggalPenerimaan *string
}

var grnStatusOptions = []string{"pending", "partially_received", "received", "rejected"}

func parseUpdateGrn(f *validate.Form) (*updateGrnInput, error) {
	in := &updateGrnInput{}
	in.Status = enumField(f, "status", optional, grnStatusOptions)
	in.Catatan = f.Str("catatan", optional, validate.StrOpts{})
	items := f.List("items", optional, 1<<30, func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		item.UUID("id", optional)
		item.UUID("grn_id", optional)
		l := updateGrnLine{Kondisi: "baik"}
		l.PurchaseOrderItemID = item.UUID("purchase_order_item_id", optional)
		if r := item.UUID("raw_material_id", validate.Rule{}); r != nil {
			l.RawMaterialID = *r
		}
		if q := item.Num("qty_diterima", validate.Rule{}, nonNegative); q != nil {
			l.QtyDiterima = *q
		}
		if q := item.Num("qty_ditolak", validate.Rule{}, nonNegative); q != nil {
			l.QtyDitolak = *q
		}
		if k := enumField(item, "kondisi", validate.Rule{HasDefault: true}, kondisiOptions); k != nil {
			l.Kondisi = *k
		}
		l.Catatan = item.Str("catatan", optionalNullable, validate.StrOpts{})
		l.BatchNumber, l.ExpiryDate = batchFields(item)
		in.Items = append(in.Items, l)
	})
	in.HasItems = items != nil
	in.TanggalPenerimaan = f.Str("tanggal_penerimaan", optional, validate.StrOpts{})
	return in, f.Err("Validation failed")
}

/* ── Query strings ───────────────────────────────────────────────────── */

// queryForm is parseSearchParams: Object.fromEntries(searchParams) (the last
// value of a repeated key wins) validated as a body would be.
func queryForm(r *http.Request) *validate.Form {
	m := map[string]any{}
	for k, vs := range r.URL.Query() {
		m[k] = vs[len(vs)-1]
	}
	return validate.New(m, true)
}

// coerceNumber is z.coerce.number().min(min)[.max(max)].default(def).
func coerceNumber(f *validate.Form, key string, def, min float64, max *float64) float64 {
	raw, sent := f.Fields()[key]
	if !sent {
		return def
	}
	s, _ := raw.(string)
	n, ok := jsNumberStrict(s)
	if !ok {
		f.Fail(key, "invalid_type", "Invalid input: expected number, received NaN")
		return 0
	}
	f.CheckNumber(key, jsonNumber(n), validate.NumOpts{Min: &min, Max: max})
	return n
}

// paramsError is parseSearchParams' 400.
func paramsError(f *validate.Form) error {
	if f.Valid() {
		return nil
	}
	return httpx.BadRequest("Parameter tidak valid", f.Issues())
}

// jsNumberStrict is Number(s) with NaN reported as !ok ("" is 0).
func jsNumberStrict(s string) (float64, bool) {
	t := strings.TrimSpace(s)
	if t == "" {
		return 0, true
	}
	return parseJSNumber(t)
}

// recordField is z.record(z.string(), z.unknown()|z.string()).optional():
// the object re-encoded for a jsonb column.
func recordField(f *validate.Form, key string, stringValues bool) json.RawMessage {
	v, _, done := f.Take(key, "record", optional)
	if done {
		return nil
	}
	m, ok := v.(map[string]any)
	if !ok {
		f.Fail(key, "invalid_type", "Invalid input: expected record, received "+jsTypeName(v))
		return nil
	}
	if stringValues {
		for _, k := range sortedKeys(m) {
			if _, isStr := m[k].(string); !isStr {
				f.Fail(key, "invalid_type", "Invalid input: expected string, received "+jsTypeName(m[k]))
				issues := f.Issues()
				issues[len(issues)-1].Path = append(issues[len(issues)-1].Path, k)
			}
		}
	}
	raw, _ := json.Marshal(m)
	return raw
}

func jsTypeName(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case json.Number:
		return "number"
	case bool:
		return "boolean"
	case []any:
		return "array"
	}
	return "object"
}

// parseGrnQc is createQcSchema of POST /grn/[id]/qc.
func parseGrnQc(f *validate.Form) (*QcInput, error) {
	in := &QcInput{}
	if st := enumField(f, "status", optional, []string{"approved", "rejected", "partial"}); st != nil {
		in.Status = *st
	}
	in.ParameterInspeksi = recordField(f, "parameter_inspeksi", false)
	in.HasilInspeksi = recordField(f, "hasil_inspeksi", true)
	in.Catatan = f.Str("catatan", optionalNullable, validate.StrOpts{})
	in.Rekomendasi = f.Str("rekomendasi", optionalNullable, validate.StrOpts{})
	listMin1(f, "items", "At least one item is required", func(items *validate.Form, i int, v any) {
		start := len(f.Issues())
		item := items.Item(i, v)
		q := QcItem{}
		if g := item.UUID("grn_item_id", validate.Rule{}); g != nil {
			q.GrnItemID = *g
		}
		q.RawMaterialID = item.Str("raw_material_id", optionalNullable, uuidOpts)
		q.ProductID = item.Str("product_id", optionalNullable, uuidOpts)
		if x := item.Num("qty_inspected", validate.Rule{}, nonNegative); x != nil {
			q.QtyInspected = *x
		}
		if x := item.Num("qty_accepted", validate.Rule{}, nonNegative); x != nil {
			q.QtyAccepted = *x
		}
		if x := item.Num("qty_rejected", validate.Rule{}, nonNegative); x != nil {
			q.QtyRejected = *x
		}
		q.Catatan = item.Str("catatan", optionalNullable, validate.StrOpts{})
		if !fatalSince(f, start) && deref(q.RawMaterialID) == "" && deref(q.ProductID) == "" {
			item.Fail("raw_material_id", "custom", "Item QC wajib memiliki raw material atau product")
		}
		in.Items = append(in.Items, q)
	})
	return in, f.Err("Validation failed")
}

// parseLegacyQc is createQcSchema of POST /qc plus toQcInspectionItems.
func parseLegacyQc(f *validate.Form) (*QcInput, error) {
	in := &QcInput{}
	if g := f.Str("grn_id", validate.Rule{}, uuidMsg("GRN ID tidak valid")); g != nil {
		in.GrnID = *g
	}
	type legacy struct {
		item                                           QcItem
		jumlahDiperiksa, jumlahDiterima, jumlahDitolak *float64
		qtyInspected, qtyAccepted, qtyRejected         *float64
		alasan                                         *string
	}
	var lines []legacy
	listMin1(f, "items", "Minimal 1 item QC", func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		l := legacy{}
		if g := item.Str("grn_item_id", validate.Rule{}, uuidMsg("GRN Item ID tidak valid")); g != nil {
			l.item.GrnItemID = *g
		}
		bahan := item.Str("bahan_baku_id", optional, uuidMsg("Raw material ID tidak valid"))
		raw := item.Str("raw_material_id", optional, uuidMsg("Raw material ID tidak valid"))
		l.item.RawMaterialID = firstNonNil(nonEmpty(raw), nonEmpty(bahan))
		l.jumlahDiperiksa = item.Num("jumlah_diperiksa", optional, nonNegative)
		l.jumlahDiterima = item.Num("jumlah_diterima", optional, nonNegative)
		l.jumlahDitolak = item.Num("jumlah_ditolak", optional, nonNegative)
		l.qtyInspected = item.Num("qty_inspected", optional, nonNegative)
		l.qtyAccepted = item.Num("qty_accepted", optional, nonNegative)
		l.qtyRejected = item.Num("qty_rejected", optional, nonNegative)
		enumField(item, "hasil", optional, []string{"passed", "rejected", "partial"})
		recordField(item, "parameter_inspeksi", false)
		l.alasan = item.Str("alasan", optional, validate.StrOpts{})
		l.item.Catatan = item.Str("catatan", optionalNullable, validate.StrOpts{})
		lines = append(lines, l)
	})
	in.Catatan = f.Str("catatan", optionalNullable, validate.StrOpts{})
	in.ParameterInspeksi = recordField(f, "parameter_inspeksi", false)
	in.HasilInspeksi = recordField(f, "hasil_inspeksi", true)
	in.Rekomendasi = f.Str("rekomendasi", optionalNullable, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return nil, err
	}
	first := func(ps ...*float64) *float64 {
		for _, p := range ps {
			if p != nil {
				return p
			}
		}
		return nil
	}
	accepted := make([]float64, len(lines))
	rejected := make([]float64, len(lines))
	for i, l := range lines {
		if l.item.RawMaterialID == nil {
			return nil, badRequest("raw_material_id atau bahan_baku_id wajib diisi per item")
		}
		q := l.item
		if p := first(l.qtyAccepted, l.jumlahDiterima); p != nil {
			q.QtyAccepted = *p
		}
		if p := first(l.qtyRejected, l.jumlahDitolak); p != nil {
			q.QtyRejected = *p
		}
		q.QtyInspected = q.QtyAccepted + q.QtyRejected
		if p := first(l.qtyInspected, l.jumlahDiperiksa); p != nil {
			q.QtyInspected = *p
		}
		if q.Catatan == nil {
			q.Catatan = l.alasan
		}
		in.Items = append(in.Items, q)
		accepted[i], rejected[i] = q.QtyAccepted, q.QtyRejected
	}
	in.Status = domain.QcOverallStatus(accepted, rejected)
	return in, nil
}

// parseCreateDelivery is createDeliverySchema.
func parseCreateDelivery(f *validate.Form) (*createDeliveryInput, error) {
	in := &createDeliveryInput{}
	start := len(f.Issues())
	if p := f.Str("po_id", validate.Rule{}, uuidMsg("Purchase order identifier must be valid")); p != nil {
		in.PoID = *p
	}
	in.SupplierID = f.Str("supplier_id", optional, uuidMsg("Supplier identifier must be valid"))
	in.VendorID = f.Str("vendor_id", optional, uuidMsg("Vendor identifier must be valid"))
	in.ModuleType = enumField(f, "module_type", optional, []string{"raw_material", "product"})
	req := func(key, msg string) string {
		if v := f.Str(key, validate.Rule{}, strMin1Msg(msg)); v != nil {
			return *v
		}
		return ""
	}
	in.TanggalKirim = req("tanggal_kirim", "Shipment date is required")
	in.NoSuratJalan = req("no_surat_jalan", "Delivery note number is required")
	in.NoResi = f.Str("no_resi", optional, validate.StrOpts{})
	in.Kurir = f.Str("kurir", optional, validate.StrOpts{})
	in.TanggalEstimasi = req("tanggal_estimasi_tiba", "Estimated arrival date is required")
	in.Catatan = f.Str("catatan", optional, validate.StrOpts{})
	if !fatalSince(f, start) {
		if domain.ModuleType(deref(in.ModuleType)) == "product" {
			if deref(in.VendorID) == "" {
				f.Fail("vendor_id", "custom", "Vendor is required")
			}
		} else if deref(in.SupplierID) == "" {
			f.Fail("supplier_id", "custom", "Supplier is required")
		}
	}
	return in, f.Err("Validation failed")
}
