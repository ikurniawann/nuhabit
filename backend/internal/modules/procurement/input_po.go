package procurement

import (
	"nuhabit/backend/internal/platform/validate"
)

// poLineInput is one validated PO create line (po-schemas.ts).
type poLineInput struct {
	PrItemID, SatuanID, Notes              *string
	RawMaterialID, ProductID, SupplyItemID *string
	PosSkuID                               *string
	Qty, Price                             float64
}

// poCreateInput is rawMaterialPoCreateSchema / productPoCreateSchema /
// generalPoCreateSchema.
type poCreateInput struct {
	PrID                        *string
	TanggalKirimEstimasi        *string
	Catatan, AlamatPengiriman   *string
	DiskonPersen, DiskonNominal float64
	PpnPersen                   float64
	SourceType                  string
	SupplierID, VendorID        *string
	TanggalPo                   string
	ProductionOrderID           *string
	SourceReference             *string
	Items                       []poLineInput
}

type poSchemaText struct {
	party, date, items, item, qty, price string
}

var poSchemas = map[string]poSchemaText{
	"raw_material": {"Supplier wajib dipilih", "Format tanggal: YYYY-MM-DD", "Minimal 1 item PO", "Bahan baku wajib dipilih", "Jumlah pesanan minimal 0.0001", "Harga tidak boleh negatif"},
	"product":      {"Vendor is required", "Date format must be YYYY-MM-DD", "At least one PO item is required", "Product is required", "Order quantity must be at least 0.0001", "Price cannot be negative"},
	"general":      {"Vendor wajib dipilih", "Format tanggal: YYYY-MM-DD", "Minimal 1 item PO", "Barang operasional wajib dipilih", "Jumlah pesanan minimal 0.0001", "Harga tidak boleh negatif"},
}

var (
	optional         = validate.Rule{Optional: true}
	optionalNullable = validate.Rule{Optional: true, Nullable: true}
	uuidOpts         = validate.StrOpts{Check: validate.UUIDCheck}
	percentBounds    = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}
	nonNegative      = validate.NumOpts{Min: validate.Bound(0)}
)

// parsePoCreate is parsePoCreateBody: the first issue becomes the 400 error.
func parsePoCreate(body any, moduleType string) (*poCreateInput, error) {
	text := poSchemas[moduleType]
	f := validate.New(body, true)
	in := &poCreateInput{}
	in.PrID = f.Str("pr_id", optional, uuidOpts)
	in.TanggalKirimEstimasi = optionalDate(f, "tanggal_kirim_estimasi")
	in.Catatan = f.Str("catatan", optional, validate.StrOpts{})
	in.AlamatPengiriman = f.Str("alamat_pengiriman", optional, validate.StrOpts{})
	in.DiskonPersen = numDefault(f, "diskon_persen", 0, percentBounds)
	in.DiskonNominal = numDefault(f, "diskon_nominal", 0, nonNegative)
	in.PpnPersen = numDefault(f, "ppn_persen", 11, percentBounds)
	in.SourceType = "manual"
	if st := f.Enum("source_type", optional, []string{"manual", "production_order", "low_stock"}); st != nil {
		in.SourceType = *st
	}
	partyKey := "vendor_id"
	if moduleType == "raw_material" {
		partyKey = "supplier_id"
	}
	party := f.Str(partyKey, validate.Rule{}, uuidMsg(text.party))
	if moduleType == "raw_material" {
		in.SupplierID = party
	} else {
		in.VendorID = party
	}
	if d := f.Str("tanggal_po", validate.Rule{}, isoDateCheck(text.date)); d != nil {
		in.TanggalPo = *d
	}
	if moduleType == "raw_material" {
		in.ProductionOrderID = f.Str("production_order_id", optionalNullable, uuidOpts)
		in.SourceReference = f.Str("source_reference", optionalNullable, validate.StrOpts{})
	}
	listMin1(f, "items", text.items, func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		line := poLineInput{}
		line.PrItemID = item.Str("pr_item_id", optional, uuidOpts)
		line.SatuanID = item.Str("satuan_id", optional, uuidOpts)
		line.Notes = item.Str("notes", optional, validate.StrOpts{})
		switch moduleType {
		case "product":
			line.ProductID = item.Str("product_id", validate.Rule{}, uuidMsg(text.item))
		case "general":
			line.SupplyItemID = item.Str("supply_item_id", validate.Rule{}, uuidMsg(text.item))
		default:
			line.RawMaterialID = item.Str("raw_material_id", validate.Rule{}, uuidMsg(text.item))
		}
		if q := numberMsg(item, "qty_ordered", validate.Rule{}, 0.0001, text.qty); q != nil {
			line.Qty = *q
		}
		if p := numberMsg(item, "harga_satuan", validate.Rule{}, 0, text.price); p != nil {
			line.Price = *p
		}
		if moduleType == "product" {
			line.PosSkuID = item.Str("pos_sku_id", optionalNullable, uuidOpts)
		}
		in.Items = append(in.Items, line)
	})
	if err := firstIssueError(f, "Validasi gagal"); err != nil {
		return nil, err
	}
	return in, nil
}

// poUpdateInput is poUpdateSchema; nil fields were not sent. Nullable fields
// sent as null are recorded in nulls.
type poUpdateInput struct {
	fields                                 []string
	values                                 map[string]any
	DiskonPersen, DiskonNominal, PpnPersen *float64
}

func parsePoUpdate(f *validate.Form) (*poUpdateInput, error) {
	in := &poUpdateInput{values: map[string]any{}}
	set := func(key string, v any, sent bool) {
		if sent {
			in.fields = append(in.fields, key)
			in.values[key] = v
		}
	}
	str := func(key string, r validate.Rule, o validate.StrOpts) {
		_, sent := f.Fields()[key]
		v := f.Str(key, r, o)
		set(key, v, sent && (v != nil || r.Nullable))
	}
	num := func(key string, o validate.NumOpts) *float64 {
		_, sent := f.Fields()[key]
		v := f.Num(key, optional, o)
		set(key, v, sent && v != nil)
		return v
	}
	if f.Fields() != nil {
		str("supplier_id", optional, uuidOpts)
		str("tanggal_po", optional, isoDateCheck(""))
		str("tanggal_kirim_estimasi", optionalNullable, isoDateCheck(""))
		str("catatan", optionalNullable, validate.StrOpts{})
		str("alamat_pengiriman", optionalNullable, validate.StrOpts{})
		in.DiskonPersen = num("diskon_persen", percentBounds)
		in.DiskonNominal = num("diskon_nominal", nonNegative)
		in.PpnPersen = num("ppn_persen", percentBounds)
	}
	return in, f.Err("Validation failed")
}

// poItemCreateInput is poItemCreateSchema.
type poItemCreateInput struct {
	RawMaterialID      string
	PrItemID, SatuanID *string
	Catatan            *string
	Qty, Price, Diskon float64
}

func parsePoItemCreate(f *validate.Form) (*poItemCreateInput, error) {
	in := &poItemCreateInput{}
	if v := f.Str("raw_material_id", validate.Rule{}, uuidMsg("Bahan baku wajib dipilih")); v != nil {
		in.RawMaterialID = *v
	}
	in.PrItemID = f.Str("pr_item_id", optional, uuidOpts)
	if q := numberMsg(f, "qty_ordered", validate.Rule{}, 0.0001, "Jumlah pesanan minimal 0.0001"); q != nil {
		in.Qty = *q
	}
	in.SatuanID = f.Str("satuan_id", optional, uuidOpts)
	if p := numberMsg(f, "harga_satuan", validate.Rule{}, 0, "Harga tidak boleh negatif"); p != nil {
		in.Price = *p
	}
	in.Diskon = numDefault(f, "diskon_item", 0, nonNegative)
	in.Catatan = f.Str("catatan", optional, validate.StrOpts{})
	return in, f.Err("Validation failed")
}

// parsePoItemUpdate is poItemUpdateSchema (validated only: the TS lookup of
// the item always fails before the values are used).
// parsePoItemUpdate is poItemUpdateSchema: the sent fields become the
// update's columns, a sent null clears the column.
func parsePoItemUpdate(f *validate.Form) (*fields, error) {
	out := &fields{}
	num := func(key string, o validate.NumOpts) {
		if v := f.Num(key, optional, o); v != nil {
			out.set(key, *v, "::numeric")
		}
	}
	str := func(key string, o validate.StrOpts, cast string) {
		v := f.Str(key, optionalNullable, o)
		if _, sent := f.Fields()[key]; sent {
			out.set(key, v, cast)
		}
	}
	num("qty_ordered", validate.NumOpts{Min: validate.Bound(0.0001)})
	str("satuan_id", uuidOpts, "::text::uuid")
	num("harga_satuan", nonNegative)
	num("diskon_item", nonNegative)
	str("catatan", validate.StrOpts{}, "")
	return out, f.Err("Validation failed")
}

// poPaymentTermInput is poPaymentTermSchema.
type poPaymentTermInput struct {
	TermNo      *int
	Description string
	DueDate     string
	Amount      float64
	Notes       *string
}

func parsePoPaymentTerm(f *validate.Form) (*poPaymentTermInput, error) {
	in := &poPaymentTermInput{}
	in.TermNo = f.Int("term_no", optional, validate.NumOpts{Min: validate.Bound(1)})
	in.Description = f.StrDefault("description", "Termin", validate.StrOpts{Min: 1})
	if d := f.Str("due_date", validate.Rule{}, isoDateCheck("")); d != nil {
		in.DueDate = *d
	}
	if a := f.Num("amount", validate.Rule{}, nonNegative); a != nil {
		in.Amount = *a
	}
	in.Notes = f.Str("notes", optionalNullable, validate.StrOpts{})
	return in, f.Err("Validation failed")
}

// reasonField is z.object({ reason: z.string().min(1, msg) }).
func reasonField(f *validate.Form, msg string) (string, error) {
	reason := f.Str("reason", validate.Rule{}, strMin1Msg(msg))
	if err := f.Err("Validation failed"); err != nil {
		return "", err
	}
	return *reason, nil
}
