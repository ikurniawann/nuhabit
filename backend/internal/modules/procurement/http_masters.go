package procurement

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Port of frontend/src/app/api/purchasing/{suppliers,vendors,vendor-price-list}/**.
func (h *Handler) masterRoutes(add addRoute) {
	add("GET /api/purchasing/suppliers", h.listSuppliers)
	add("POST /api/purchasing/suppliers", h.createSupplier)
	add("GET /api/purchasing/suppliers/{id}", h.supplierDetail)
	add("PUT /api/purchasing/suppliers/{id}", h.updateSupplier)
	add("DELETE /api/purchasing/suppliers/{id}", h.deleteSupplier)
	add("GET /api/purchasing/suppliers/{id}/price-history", h.supplierPriceHistory)

	add("GET /api/purchasing/vendors", h.listVendors)
	add("POST /api/purchasing/vendors", h.createVendor)
	add("GET /api/purchasing/vendors/{id}", h.vendorDetail)
	add("PUT /api/purchasing/vendors/{id}", h.updateVendor)
	add("DELETE /api/purchasing/vendors/{id}", h.deactivateVendor)

	add("GET /api/purchasing/vendor-price-list", h.listPriceLists)
	add("POST /api/purchasing/vendor-price-list", h.createPriceList)
	add("GET /api/purchasing/vendor-price-list/{id}", h.priceListDetail)
	add("PUT /api/purchasing/vendor-price-list/{id}", h.updatePriceList)
	add("DELETE /api/purchasing/vendor-price-list/{id}", h.deactivatePriceList)
}

/* ── zod helpers for these schemas ───────────────────────────────────── */

var emailBody = regexp.MustCompile(`^([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

// isZodEmail is zod v4's email regex (its lookaheads spelled out).
func isZodEmail(s string) bool {
	return !strings.HasPrefix(s, ".") && !strings.Contains(s, "..") && emailBody.MatchString(s)
}

func emailOpts(msg string) validate.StrOpts {
	return validate.StrOpts{Check: func(s string) (string, string, bool) { return "invalid_format", msg, isZodEmail(s) }}
}

// optionalEmail is z.string().email(msg).optional().or(z.literal("")).
func optionalEmail(f *validate.Form, key, msg string) *string {
	v, sent := f.Fields()[key]
	if !sent {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		f.Fail(key, "invalid_union", "Invalid input")
		return nil
	}
	if s != "" && !isZodEmail(s) {
		f.Fail(key, "invalid_format", msg)
	}
	return &s
}

// maxLen is z.string().max(n) (with an optional .min(1, msg) first).
func maxLen(n int, minMsg string) validate.StrOpts {
	o := validate.StrOpts{Max: n}
	if minMsg != "" {
		o.Check = func(s string) (string, string, bool) { return "too_small", minMsg, validate.UTF16Len(s) >= 1 }
	}
	return o
}

// formFields collects the sent schema fields into insert/update columns.
type formFields struct {
	f   *validate.Form
	out *fields
}

func newFormFields(f *validate.Form) *formFields { return &formFields{f: f, out: &fields{}} }

func (ff *formFields) str(key string, r validate.Rule, o validate.StrOpts) *string {
	v := ff.f.Str(key, r, o)
	if v != nil {
		ff.out.set(key, *v, "")
	}
	return v
}

func (ff *formFields) cast(key string, r validate.Rule, o validate.StrOpts, cast string) *string {
	v := ff.f.Str(key, r, o)
	if v != nil {
		ff.out.set(key, *v, cast)
	}
	return v
}

func (ff *formFields) email(key, msg string) {
	if v := optionalEmail(ff.f, key, msg); v != nil {
		ff.out.set(key, *v, "")
	}
}

func (ff *formFields) enum(key string, r validate.Rule, options []string, def string) *string {
	v := enumField(ff.f, key, r, options)
	if v == nil && def != "" {
		if _, sent := ff.f.Fields()[key]; !sent {
			v = &def
		}
	}
	if v != nil {
		ff.out.set(key, *v, "")
	}
	return v
}

func (ff *formFields) num(key string, r validate.Rule, o validate.NumOpts, def *float64) *float64 {
	v := ff.f.Num(key, r, o)
	if v == nil && def != nil {
		if _, sent := ff.f.Fields()[key]; !sent {
			v = def
		}
	}
	if v != nil {
		ff.out.set(key, *v, "::numeric")
	}
	return v
}

func (ff *formFields) boolean(key string, r validate.Rule, def *bool) *bool {
	v := ff.f.Bool(key, r)
	if v == nil && def != nil {
		if _, sent := ff.f.Fields()[key]; !sent {
			v = def
		}
	}
	if v != nil {
		ff.out.set(key, *v, "")
	}
	return v
}

// queryParamsError is parseBodyOrThrow over a query string: 400 with the
// first issue's message.
func queryParamsError(f *validate.Form) error { return firstIssueError(f, "Validasi gagal") }

// noContent is noContentResponse.
func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

/* ── Suppliers ───────────────────────────────────────────────────────── */

var (
	paymentTerms     = []string{"CBD", "TOP7", "TOP14", "TOP30", "TOP45", "TOP60"}
	supplierStatuses = []string{"active", "inactive", "probation", "blocked", "draft"}
	currencies       = []string{"IDR", "USD", "EUR"}
)

func (h *Handler) listSuppliers(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f := queryForm(r)
	p := SupplierListParams{SortBy: "nama_supplier", SortDir: "ASC"}
	p.Search = f.Str("search", optional, validate.StrOpts{})
	if v, sent := f.Fields()["is_active"]; sent {
		b := v != ""
		p.IsActive = &b
	}
	p.Status = enumField(f, "status", optional, supplierStatuses)
	p.PaymentTerms = enumField(f, "payment_terms", optional, paymentTerms)
	p.Page = coerceNumber(f, "page", 1, 1, nil)
	p.Limit = coerceNumber(f, "limit", 20, 1, validate.Bound(100))
	if v := enumField(f, "sort_by", validate.Rule{HasDefault: true}, []string{"nama_supplier", "kode_supplier", "kota", "created_at"}); v != nil {
		p.SortBy = *v
	}
	if v := enumField(f, "sort_dir", validate.Rule{HasDefault: true}, []string{"ASC", "DESC"}); v != nil {
		p.SortDir = *v
	}
	if err := queryParamsError(f); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	out, err := h.svc.ListSuppliers(r.Context(), p, scope)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) createSupplier(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in := &SupplierCreate{}
	in.KodeSupplier = f.Str("kode_supplier", optional, maxLen(50, "Kode supplier wajib diisi"))
	ff := newFormFields(f)
	ff.str("nama_supplier", validate.Rule{}, maxLen(200, "Nama supplier wajib diisi"))
	ff.str("pic_name", optional, maxLen(100, ""))
	ff.str("pic_phone", optional, maxLen(30, ""))
	ff.email("pic_email", "Email PIC tidak valid")
	ff.str("telepon", optional, maxLen(50, ""))
	ff.email("email", "Email tidak valid")
	ff.str("alamat", optional, validate.StrOpts{})
	ff.str("kota", optional, maxLen(100, ""))
	ff.str("npwp", optional, maxLen(50, ""))
	ff.enum("payment_terms", validate.Rule{HasDefault: true}, paymentTerms, "TOP30")
	ff.enum("currency", validate.Rule{HasDefault: true}, currencies, "IDR")
	for _, k := range []string{"bank_nama", "bank_rekening", "bank_atas_nama", "kategori", "catatan"} {
		ff.str(k, optional, validate.StrOpts{})
	}
	if st := ff.enum("status", validate.Rule{HasDefault: true}, supplierStatuses, "active"); st != nil {
		in.Status = *st
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	in.Fields = ff.out
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	row, err := h.svc.CreateSupplier(r.Context(), in, user.ID, scope)
	if err != nil {
		return err
	}
	return writeData(w, http.StatusCreated, row)
}

func (h *Handler) supplierDetail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	data, err := h.svc.SupplierDetail(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) updateSupplier(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	ff := newFormFields(f)
	ff.str("nama_supplier", optional, validate.StrOpts{Min: 1, Max: 200})
	ff.str("pic_name", optional, maxLen(100, ""))
	ff.str("pic_phone", optional, maxLen(30, ""))
	ff.email("pic_email", "Email PIC tidak valid")
	ff.email("email", "Email tidak valid")
	ff.str("alamat", optional, validate.StrOpts{})
	ff.str("telepon", optional, maxLen(30, ""))
	ff.str("kota", optional, maxLen(100, ""))
	npwp := ff.str("npwp", optional, maxLen(50, ""))
	ff.enum("payment_terms", optional, paymentTerms, "")
	ff.enum("currency", optional, currencies, "")
	for _, k := range []string{"bank_nama", "bank_rekening", "bank_atas_nama", "kategori", "catatan"} {
		ff.str(k, optional, validate.StrOpts{})
	}
	ff.enum("status", optional, supplierStatuses, "")
	ff.boolean("is_active", optional, nil)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.UpdateSupplier(r.Context(), r.PathValue("id"), ff.out, npwp, user.ID)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Supplier berhasil diperbarui")
}

func (h *Handler) deleteSupplier(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteSupplier(r.Context(), r.PathValue("id"), user.ID); err != nil {
		return err
	}
	return noContent(w)
}

var errInvalidDate = errors.New("RangeError: Invalid time value")

func (h *Handler) supplierPriceHistory(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	months, ok := queryInt(r, "months", 6)
	if !ok {
		// setMonth(NaN) makes toISOString throw.
		return errInvalidDate
	}
	page, okPage := queryInt(r, "page", 1)
	if !okPage {
		page = 1
	}
	limit, okLimit := queryInt(r, "limit", 50)
	if !okLimit {
		limit = 50
	}
	data, err := h.svc.SupplierPriceHistory(r.Context(), r.PathValue("id"), queryPtr(r, "material_id"),
		max(1, months), max(1, page), min(200, max(1, limit)))
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, data)
}

/* ── Vendors ─────────────────────────────────────────────────────────── */

var (
	vendorCategories = []string{"it", "office", "stationery", "services", "raw_material", "other"}
	vendorUsages     = []string{"fnb", "operasional", "keduanya"}
	activeStatuses   = []string{"all", "active", "inactive"}
)

func (h *Handler) listVendors(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f := queryForm(r)
	p := VendorListParams{}
	p.Search = f.Str("search", optional, validate.StrOpts{})
	p.Category = enumField(f, "category", optional, vendorCategories)
	p.UsageScope = enumField(f, "usage_scope", optional, vendorUsages)
	p.Status = enumField(f, "status", optional, activeStatuses)
	p.Page = coerceNumber(f, "page", 1, 1, nil)
	p.Limit = coerceNumber(f, "limit", 10, 1, validate.Bound(100))
	if err := queryParamsError(f); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	out, err := h.svc.ListVendors(r.Context(), p, scope)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) createVendor(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	ff := newFormFields(f)
	ff.str("name", validate.Rule{}, strMin1Msg("Vendor name is required"))
	ff.str("contact_person", validate.Rule{}, strMin1Msg("Contact person is required"))
	ff.str("phone", validate.Rule{}, strMin1Msg("Phone number is required"))
	ff.str("email", validate.Rule{}, emailOpts("Invalid email address"))
	ff.str("address", validate.Rule{}, strMin1Msg("Address is required"))
	ff.enum("category", validate.Rule{}, vendorCategories, "")
	ff.enum("usage_scope", validate.Rule{HasDefault: true}, vendorUsages, "keduanya")
	for _, k := range []string{"npwp", "bank_name", "bank_account", "bank_account_name", "notes"} {
		ff.str(k, optional, validate.StrOpts{})
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	vendor, err := h.svc.CreateVendor(r.Context(), ff.out, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, vendor, "Vendor created successfully")
}

func (h *Handler) vendorDetail(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	v, err := h.svc.ScopedVendor(r.Context(), r.PathValue("id"), scope)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, v)
}

func (h *Handler) updateVendor(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	ff := newFormFields(f)
	for _, k := range []string{"name", "contact_person", "phone"} {
		ff.str(k, optional, validate.StrOpts{Min: 1})
	}
	ff.str("email", optional, emailOpts("Invalid email address"))
	ff.str("address", optional, validate.StrOpts{Min: 1})
	ff.enum("category", optional, vendorCategories, "")
	ff.enum("usage_scope", optional, vendorUsages, "")
	for _, k := range []string{"npwp", "bank_name", "bank_account", "bank_account_name", "notes"} {
		ff.str(k, optional, validate.StrOpts{})
	}
	ff.boolean("is_active", optional, nil)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.UpdateVendor(r.Context(), r.PathValue("id"), ff.out, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Vendor updated successfully")
}

func (h *Handler) deactivateVendor(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if err := h.svc.DeactivateVendor(r.Context(), r.PathValue("id"), scope); err != nil {
		return err
	}
	return noContent(w)
}

/* ── Vendor price lists ──────────────────────────────────────────────── */

func (h *Handler) listPriceLists(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f := queryForm(r)
	p := PriceListParams{}
	p.Search = f.Str("search", optional, validate.StrOpts{})
	p.VendorID = f.UUID("vendor_id", optional)
	p.ProductID = f.UUID("product_id", optional)
	p.Status = enumField(f, "status", optional, activeStatuses)
	p.Page = coerceNumber(f, "page", 1, 1, nil)
	p.Limit = coerceNumber(f, "limit", 10, 1, validate.Bound(100))
	if err := queryParamsError(f); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	out, err := h.svc.ListPriceLists(r.Context(), p, scope)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) createPriceList(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	in := &PriceListCreate{}
	if v := f.Str("vendor_id", validate.Rule{}, uuidMsg("Vendor is required")); v != nil {
		in.VendorID = *v
	}
	if v := f.Str("product_id", validate.Rule{}, uuidMsg("Product is required")); v != nil {
		in.ProductID = *v
	}
	if v := numberMsg(f, "harga", validate.Rule{}, 0, "Price cannot be negative"); v != nil {
		in.Harga = *v
	}
	in.SatuanID = f.UUID("satuan_id", optional)
	in.MinimumQty = numDefault(f, "minimum_qty", 1, nonNegative)
	in.LeadTime = numDefault(f, "lead_time_days", 0, nonNegative)
	in.IsPreferred = f.BoolDefault("is_preferred", false)
	in.BerlakuDari = f.Str("berlaku_dari", optional, isoDateCheck("Date format must be YYYY-MM-DD"))
	in.BerlakuSampai = f.Str("berlaku_sampai", optional, isoDateCheck("Date format must be YYYY-MM-DD"))
	in.Catatan = f.Str("catatan", optional, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	row, err := h.svc.CreatePriceList(r.Context(), in, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusCreated, row, "Price list created successfully")
}

func (h *Handler) priceListDetail(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.PriceList(r.Context(), r.PathValue("id"), scope)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) updatePriceList(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	ff := newFormFields(f)
	ff.cast("vendor_id", optional, uuidOpts, "::text::uuid")
	product := ff.cast("product_id", optional, uuidOpts, "::text::uuid")
	ff.num("harga", optional, nonNegative, nil)
	satuan := ff.cast("satuan_id", optional, uuidOpts, "::text::uuid")
	ff.num("minimum_qty", optional, nonNegative, nil)
	ff.num("lead_time_days", optional, nonNegative, nil)
	ff.boolean("is_preferred", optional, nil)
	ff.cast("berlaku_dari", optional, isoDateCheck(""), "::text::date")
	ff.cast("berlaku_sampai", optional, isoDateCheck(""), "::text::date")
	ff.str("catatan", optional, validate.StrOpts{})
	ff.boolean("is_active", optional, nil)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.UpdatePriceList(r.Context(), r.PathValue("id"), ff.out, product, satuan, scope)
	if err != nil {
		return err
	}
	return writeOKMessage(w, http.StatusOK, data, "Price list updated successfully")
}

func (h *Handler) deactivatePriceList(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if err := h.svc.DeactivatePriceList(r.Context(), r.PathValue("id"), scope); err != nil {
		return err
	}
	return noContent(w)
}
