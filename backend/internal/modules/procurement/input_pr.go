package procurement

import (
	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/validate"
)

// prItemInput is one validated PR line; exactly one of the item ids is set.
type prItemInput struct {
	ProductID, RawMaterialID, SupplyItemID, SatuanID *string
	Description, Unit                                string
	Line                                             domain.PrLine
}

// prWrite is parsePrWrite: the validated body, normalized lines, total and
// the status the action leads to.
type prWrite struct {
	DepartmentID string
	Priority     string
	RequiredDate *string
	Notes        *string
	Items        []prItemInput
	Total        float64
	Status       string
}

// prSchemaText holds the messages that differ between the three PR schemas.
type prSchemaText struct {
	department, items, itemID, description, unit string
}

var prSchemas = map[string]prSchemaText{
	"raw_material": {"Department tidak valid", "Minimal 1 item", "Bahan baku wajib dipilih", "Deskripsi barang wajib diisi", "Satuan wajib diisi"},
	"product":      {"Department is invalid", "At least one item is required", "Product is required", "Description is required", "Unit is required"},
	"general":      {"Departemen tidak valid", "Minimal 1 item", "Barang operasional wajib dipilih", "Deskripsi barang wajib diisi", "Satuan wajib diisi"},
}

// parsePrWrite validates prWriteSchema / productPrWriteSchema /
// generalPrWriteSchema; a failure is parseBodyOrThrow's 400.
func parsePrWrite(body any, moduleType string) (*prWrite, error) {
	text := prSchemas[moduleType]
	f := validate.New(body, true)
	w := &prWrite{}
	if d := f.Str("department_id", validate.Rule{}, uuidMsg(text.department)); d != nil {
		w.DepartmentID = *d
	}
	if p := f.Enum("priority", validate.Rule{}, []string{"low", "medium", "high", "urgent"}); p != nil {
		w.Priority = *p
	}
	w.RequiredDate = optionalBlankStr(f, "required_date", validate.StrOpts{})
	w.Notes = optionalBlankStr(f, "notes", validate.StrOpts{})
	listMin1(f, "items", text.items, func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		in := prItemInput{}
		switch moduleType {
		case "product":
			in.ProductID = item.Str("product_id", validate.Rule{}, uuidMsg(text.itemID))
		case "general":
			in.SupplyItemID = item.Str("supply_item_id", validate.Rule{}, uuidMsg(text.itemID))
		default:
			in.ProductID = optionalBlankStr(item, "product_id", validate.StrOpts{Check: validate.UUIDCheck})
			in.RawMaterialID = item.Str("raw_material_id", validate.Rule{}, uuidMsg(text.itemID))
		}
		in.SatuanID = optionalBlankStr(item, "satuan_id", validate.StrOpts{Check: validate.UUIDCheck})
		if d := item.Str("description", validate.Rule{}, strMin1Msg(text.description)); d != nil {
			in.Description = *d
		}
		qty := localeNumber(item, "qty", 1, "Jumlah minimal 1", domain.MaxInt4, "Jumlah terlalu besar")
		if u := item.Str("unit", validate.Rule{}, strMin1Msg(text.unit)); u != nil {
			in.Unit = *u
		}
		price := localeNumber(item, "estimated_price", 0, "Harga estimasi tidak boleh negatif", domain.MaxNumeric152, "Harga estimasi terlalu besar")
		in.Line = domain.NormalizePrLine(qty, price)
		w.Items = append(w.Items, in)
	})
	action := "draft"
	if a := f.Enum("action", validate.Rule{Optional: true}, []string{"draft", "submit"}); a != nil {
		action = *a
	}
	if err := firstIssueError(f, "Validasi gagal"); err != nil {
		return nil, err
	}
	lines := make([]domain.PrLine, len(w.Items))
	for i, item := range w.Items {
		lines[i] = item.Line
	}
	w.Total = domain.SumPrTotal(lines)
	w.Status = domain.NextPrStatus(action)
	return w, nil
}

// parsePrDecision is prDecisionSchema through validateBody.
func parsePrDecision(f *validate.Form) (PrDecision, error) {
	d := PrDecision{}
	if a := f.Enum("action", validate.Rule{}, []string{"approve", "reject"}); a != nil {
		d.Action = *a
	}
	d.Reason = f.Str("reason", validate.Rule{Optional: true}, validate.StrOpts{})
	return d, f.Err("Validation failed")
}

// prConvertInput is prConvertSchema.
type prConvertInput struct {
	SupplierID                  string
	TanggalPo, TanggalKirim     *string
	Catatan, AlamatPengiriman   *string
	DiskonPersen, DiskonNominal float64
	PpnPersen                   float64
}

func parsePrConvert(f *validate.Form) (prConvertInput, error) {
	in := prConvertInput{}
	if s := f.Str("supplier_id", validate.Rule{}, uuidMsg("Supplier wajib dipilih")); s != nil {
		in.SupplierID = *s
	}
	in.TanggalPo = optionalDate(f, "tanggal_po")
	in.TanggalKirim = optionalDate(f, "tanggal_kirim_estimasi")
	in.Catatan = f.Str("catatan", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	in.AlamatPengiriman = f.Str("alamat_pengiriman", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	in.DiskonPersen = numDefault(f, "diskon_persen", 0, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)})
	in.DiskonNominal = numDefault(f, "diskon_nominal", 0, validate.NumOpts{Min: validate.Bound(0)})
	in.PpnPersen = numDefault(f, "ppn_persen", 11, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)})
	return in, f.Err("Validation failed")
}
