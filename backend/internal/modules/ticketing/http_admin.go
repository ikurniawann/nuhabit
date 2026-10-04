package ticketing

import (
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Admin routes (Master Ticket, Pengaturan Tiket, Channel Manager): venue
// settings, channels, time slots, capacity overrides, categories, bands,
// staff passes and products.

var (
	nullable        = validate.Rule{Nullable: true}
	nullableDefault = validate.Rule{Nullable: true, HasDefault: true}
	reEntryPolicies = []string{"sekali-masuk", "bebas-keluar-masuk"}
	paymentModes    = []string{"postpaid", "prepaid"}
	price           = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)}
)

func intRange(min, max float64) validate.NumOpts {
	return validate.NumOpts{Min: validate.Bound(min), Max: validate.Bound(max)}
}

// sent reports whether the body carried key (null included).
func sent(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

func patternCheck(re *regexp.Regexp, msg string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) { return "invalid_format", msg, re.MatchString(s) }
}

func dateCheck(msg string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) { return "custom", msg, domain.IsValidCalendarDate(s) }
}

// ── Settings & channels ──────────────────────────────────────────────────

var (
	slugPattern   = regexp.MustCompile(`^[a-z0-9-]{2,50}$`)
	reservedSlugs = map[string]bool{"status": true, "webhook": true, "catalog": true, "api": true}
)

func slugCheck(s string) (string, string, bool) {
	if !slugPattern.MatchString(s) {
		return "invalid_format", "Slug: huruf kecil, angka, tanda hubung (2-50)", false
	}
	if reservedSlugs[s] {
		return "custom", "Slug ini kata terpakai sistem — pilih slug lain", false
	}
	return "", "", true
}

func (h *handler) getSettings(w http.ResponseWriter, r *http.Request, v Venue) error {
	row, err := h.svc.Settings(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, row)
}

func (h *handler) updateSettings(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	p := newPatch(3, "updated_by = $3")
	if s := f.Enum("re_entry_policy", optional, reEntryPolicies); s != nil {
		p.add("re_entry_policy", *s)
	}
	if n := f.Num("default_credit_limit", optional, price); n != nil {
		p.add("default_credit_limit", *n)
	}
	if s := f.Enum("default_payment_mode", optional, paymentModes); s != nil {
		p.add("default_payment_mode", *s)
	}
	if s := f.Str("booking_slug", optionalNull, validate.StrOpts{Check: slugCheck}); s != nil || sent(f, "booking_slug") {
		p.add("booking_slug", s)
	}
	if n := f.Int("booking_forfeit_days", optionalNull, intRange(0, 365)); n != nil || sent(f, "booking_forfeit_days") {
		p.add("booking_forfeit_days", n)
	}
	if n := f.Int("daily_capacity", optionalNull, intRange(1, 1_000_000)); n != nil || sent(f, "daily_capacity") {
		p.add("daily_capacity", n)
	}
	if n := f.Int("slot_grace_minutes", optional, intRange(0, 240)); n != nil {
		p.add("slot_grace_minutes", *n)
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.UpdateSettings(r.Context(), v, p)
	if err != nil {
		return err
	}
	return ok(w, row, "Pengaturan tersimpan")
}

func (h *handler) listChannels(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListChannels(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) updateChannel(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	p := newPatch(3)
	if s := f.Str("name", optional, trimmed(1, 100)); s != nil {
		p.add("name", *s)
	}
	if b := f.Bool("is_active", optional); b != nil {
		p.add("is_active", *b)
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.UpdateChannel(r.Context(), v, r.PathValue("id"), p)
	if err != nil {
		return err
	}
	return ok(w, row, "Kanal diperbarui")
}

// ── Time slots & capacity overrides ──────────────────────────────────────

var timeCheck = patternCheck(regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`), "Format jam HH:MM")

func (h *handler) listTimeSlots(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListTimeSlots(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createTimeSlot(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := TimeSlotInput{
		Label:     deref(f.Str("label", required, trimmed(1, 80))),
		StartTime: deref(f.Str("start_time", required, validate.StrOpts{Check: timeCheck})),
		EndTime:   deref(f.Str("end_time", required, validate.StrOpts{Check: timeCheck})),
		Capacity:  f.Int("capacity", nullableDefault, intRange(1, 1_000_000)),
	}
	if n := f.Int("sort_order", hasDefault, intRange(0, 1000)); n != nil {
		in.SortOrder = *n
	}
	if f.Valid() && in.EndTime <= in.StartTime {
		f.Fail("end_time", "custom", "Jam selesai harus setelah jam mulai")
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.CreateTimeSlot(r.Context(), v, in)
	if err != nil {
		return err
	}
	return ok(w, row, "Slot waktu ditambahkan")
}

func (h *handler) updateTimeSlot(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	p := newPatch(3)
	if s := f.Str("label", optional, trimmed(1, 80)); s != nil {
		p.add("label", *s)
	}
	start := f.Str("start_time", optional, validate.StrOpts{Check: timeCheck})
	if start != nil {
		p.add("start_time", *start)
	}
	end := f.Str("end_time", optional, validate.StrOpts{Check: timeCheck})
	if end != nil {
		p.add("end_time", *end)
	}
	if n := f.Int("capacity", optionalNull, intRange(1, 1_000_000)); n != nil || sent(f, "capacity") {
		p.add("capacity", n)
	}
	if n := f.Int("sort_order", optional, intRange(0, 1000)); n != nil {
		p.add("sort_order", *n)
	}
	if b := f.Bool("is_active", optional); b != nil {
		p.add("is_active", *b)
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.UpdateTimeSlot(r.Context(), v, r.PathValue("id"), start, end, p)
	if err != nil {
		return err
	}
	return ok(w, row, "Slot waktu diperbarui")
}

func (h *handler) deleteTimeSlot(w http.ResponseWriter, r *http.Request, v Venue) error {
	id := r.PathValue("id")
	if err := h.svc.DeleteTimeSlot(r.Context(), v, id); err != nil {
		return err
	}
	return ok(w, object("id", id), "Slot waktu dihapus")
}

func (h *handler) listCapacityDates(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListCapacityDates(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createCapacityDate(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := CapacityDateInput{
		Label:     deref(f.Str("label", required, trimmed(1, 120))),
		StartDate: deref(f.Str("start_date", required, validate.StrOpts{Check: dateCheck("Tanggal mulai tidak valid")})),
		EndDate:   deref(f.Str("end_date", required, validate.StrOpts{Check: dateCheck("Tanggal akhir tidak valid")})),
		Capacity:  deref(f.Int("capacity", required, intRange(0, 1_000_000))),
	}
	if f.Valid() && in.EndDate < in.StartDate {
		f.Fail("end_date", "custom", endBeforeStart)
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.CreateCapacityDate(r.Context(), v, in)
	if err != nil {
		return err
	}
	return ok(w, row, "Override kapasitas ditambahkan")
}

func (h *handler) updateCapacityDate(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	p := newPatch(3)
	if s := f.Str("label", optional, trimmed(1, 120)); s != nil {
		p.add("label", *s)
	}
	start := f.Str("start_date", optional, validate.StrOpts{Check: dateCheck("Tanggal mulai tidak valid")})
	if start != nil {
		p.add("start_date", *start)
	}
	end := f.Str("end_date", optional, validate.StrOpts{Check: dateCheck("Tanggal akhir tidak valid")})
	if end != nil {
		p.add("end_date", *end)
	}
	if n := f.Int("capacity", optional, intRange(0, 1_000_000)); n != nil {
		p.add("capacity", *n)
	}
	if b := f.Bool("is_active", optional); b != nil {
		p.add("is_active", *b)
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.UpdateCapacityDate(r.Context(), v, r.PathValue("id"), start, end, p)
	if err != nil {
		return err
	}
	return ok(w, row, "Override kapasitas diperbarui")
}

func (h *handler) deleteCapacityDate(w http.ResponseWriter, r *http.Request, v Venue) error {
	id := r.PathValue("id")
	if err := h.svc.DeleteCapacityDate(r.Context(), v, id); err != nil {
		return err
	}
	return ok(w, object("id", id), "Override kapasitas dihapus")
}

// ── Categories ───────────────────────────────────────────────────────────

func (h *handler) listCategories(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListCategories(r.Context(), v, queryTrim(r.URL.Query(), "q"))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createCategory(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	name := f.Str("name", required, trimmed(1, 100))
	if !f.Valid() {
		return httpx.BadRequest("Nama kategori wajib diisi")
	}
	row, created, err := h.svc.EnsureCategory(r.Context(), v, *name)
	if err != nil {
		return err
	}
	if created {
		return ok(w, row, "Kategori ditambahkan")
	}
	return ok(w, row)
}

// ── Bands & staff passes ─────────────────────────────────────────────────

func (h *handler) listBands(w http.ResponseWriter, r *http.Request, v Venue) error {
	q := r.URL.Query()
	page, limit := readPage(q, 100)
	res, err := h.svc.ListBands(r.Context(), v, queryTrim(q, "q"), query(q, "status", ""), page, limit)
	if err != nil {
		return err
	}
	return paginated(w, res.Items, page, limit, res.Total)
}

func (h *handler) registerBand(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	uid := f.Str("nfc_uid", required, trimmed(1, 80))
	label := f.Str("label", optionalNull, trimmed(0, 60))
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.RegisterBand(r.Context(), v, *uid, label)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, row, "Gelang terdaftar")
}

func (h *handler) updateBand(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	p := BandPatch{Label: f.Str("label", optionalNull, trimmed(0, 60)), LabelSet: sent(f, "label")}
	p.Status = f.Enum("status", optional, BandStatuses)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.UpdateBand(r.Context(), v, r.PathValue("id"), p)
	if err != nil {
		return err
	}
	return ok(w, row, "Gelang diperbarui")
}

func (h *handler) listStaffPasses(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListStaffPasses(r.Context(), v, queryTrim(r.URL.Query(), "q"))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) pairStaffPass(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	uid := f.Str("nfc_uid", required, trimmed(1, 80))
	employeeID := f.UUID("employee_id", required)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id, employee, err := h.svc.PairStaffPass(r.Context(), v, *uid, *employeeID)
	if err != nil {
		return err
	}
	return ok(w, object("id", id), "Gelang dipasangkan ke "+employee)
}

func (h *handler) revokeStaffPass(w http.ResponseWriter, r *http.Request, v Venue) error {
	id := r.PathValue("id")
	if err := h.svc.RevokeStaffPass(r.Context(), v, id); err != nil {
		return err
	}
	return ok(w, object("id", id), "Pairing dicabut — gelang kembali tersedia")
}

// ── Products ─────────────────────────────────────────────────────────────

func (h *handler) channelBoard(w http.ResponseWriter, r *http.Request, v Venue) error {
	board, err := h.svc.ChannelBoard(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, board)
}

func (h *handler) loketOptions(w http.ResponseWriter, r *http.Request, v Venue) error {
	options, err := h.svc.LoketOptions(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, options)
}

func (h *handler) listProducts(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListProducts(r.Context(), v, queryTrim(r.URL.Query(), "q"))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) productDetail(w http.ResponseWriter, r *http.Request, v Venue) error {
	out, err := h.svc.ProductDetail(r.Context(), v, r.PathValue("id"))
	if err != nil {
		return err
	}
	return ok(w, out)
}

func strDefault(f *validate.Form, key, def string, options []string) string {
	if s := f.Str(key, hasDefault, validate.StrOpts{Check: validate.EnumCheck(options)}); s != nil {
		return *s
	}
	return def
}

func (h *handler) createProduct(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := CreateProductInput{
		Name:           deref(f.Str("name", required, trimmed(1, 150))),
		ProductKind:    strDefault(f, "product_kind", "single", []string{"single", "bundle", "season_pass"}),
		ValidityMonths: 12,
	}
	if n := f.Int("validity_months", hasDefault, intRange(1, 120)); n != nil {
		in.ValidityMonths = *n
	}
	in.EntryPolicy = strDefault(f, "entry_policy", "once_per_day", []string{"once_per_day", "unlimited", "limited_visits"})
	in.VisitQuota = f.Int("visit_quota", optionalNull, intRange(1, 1000))
	if n := f.Num("member_discount_percent", hasDefault, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}); n != nil {
		in.MemberDiscountPercent = *n
	}
	in.VariantPreset = strDefault(f, "variant_preset", "adult-child", []string{"adult-child", "umum"})
	in.CategoryID = f.UUID("category_id", optionalNull)
	in.CategoryName = f.Str("category_name", optionalNull, trimmed(0, 100))
	in.Status = strDefault(f, "status", "draft", []string{"draft", "active"})
	if n := f.Num("base_price", hasDefault, price); n != nil {
		in.BasePrice = *n
	}
	if n := f.Num("cogs", hasDefault, price); n != nil {
		in.Cogs = *n
	}
	in.HasGate = f.BoolDefault("has_gate", true)
	in.Description = f.Str("description", optionalNull, trimmed(0, 2000))
	in.ReEntryPolicy = f.Enum("re_entry_policy", optional, reEntryPolicies)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id, code, err := h.svc.CreateProduct(r.Context(), v, in)
	if err != nil {
		return err
	}
	return ok(w, object("id", id, "code", code), "Ticket "+code+" dibuat")
}

func (h *handler) updateProduct(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := UpdateProductInput{Fields: newPatch(1)}
	if s := f.Str("name", optional, trimmed(1, 150)); s != nil {
		in.Fields.add("name", *s)
	}
	in.CategoryID = f.UUID("category_id", optionalNull)
	in.CategoryIDSet = sent(f, "category_id")
	in.CategoryName = f.Str("category_name", optionalNull, trimmed(0, 100))
	if in.Status = f.Enum("status", optional, []string{"draft", "active"}); in.Status != nil {
		in.Fields.add("status", *in.Status)
	}
	if n := f.Num("base_price", optional, price); n != nil {
		in.Fields.add("base_price", *n)
	}
	if n := f.Num("cogs", optional, price); n != nil {
		in.Fields.add("cogs", *n)
	}
	if b := f.Bool("has_gate", optional); b != nil {
		in.Fields.add("has_gate", *b)
	}
	if d := f.Str("description", optionalNull, trimmed(0, 2000)); d != nil || sent(f, "description") {
		in.Fields.add("description", orNil(d))
	}
	if s := f.Enum("re_entry_policy", optional, reEntryPolicies); s != nil {
		in.Fields.add("re_entry_policy", *s)
	}
	f.List("variants", optional, 10, func(list *validate.Form, i int, raw any) {
		item := list.Item(i, raw)
		vp := VariantPatch{ID: deref(item.UUID("id", required)), Fields: newPatch(2)}
		if s := item.Str("name", optional, trimmed(1, 60)); s != nil {
			vp.Fields.add("name", *s)
		}
		for _, key := range []string{"price_regular", "price_high"} {
			if n := item.Num(key, optionalNull, price); n != nil || sent(item, key) {
				vp.Fields.add(key, n)
			}
		}
		if b := item.Bool("is_active", optional); b != nil {
			vp.Fields.add("is_active", *b)
		}
		in.Variants = append(in.Variants, vp)
	})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.svc.UpdateProduct(r.Context(), v, id, in); err != nil {
		return err
	}
	return ok(w, object("id", id), "Ticket tersimpan")
}

func (h *handler) saveBundleItems(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	items := []BundleItem{}
	f.List("items", required, 10, func(list *validate.Form, i int, raw any) {
		item := list.Item(i, raw)
		items = append(items, BundleItem{
			ComponentVariantID: deref(item.UUID("component_variant_id", required)),
			Qty:                deref(item.Int("qty", required, intRange(1, 20))),
		})
	})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.svc.SaveBundleItems(r.Context(), v, id, items); err != nil {
		return err
	}
	return ok(w, object("id", id), "Komposisi paket tersimpan")
}

func (h *handler) saveChannelPrices(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	channelID := f.UUID("channel_id", required)
	var prices []ChannelPrice
	items := f.List("prices", required, 50, func(list *validate.Form, i int, raw any) {
		item := list.Item(i, raw)
		prices = append(prices, ChannelPrice{
			VariantID:    deref(item.UUID("variant_id", required)),
			PriceRegular: item.Num("price_regular", nullable, price),
			PriceHigh:    item.Num("price_high", nullable, price),
		})
	})
	if items != nil && len(items) < 1 {
		f.Fail("prices", "too_small", "Too small: expected array to have >=1 items")
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.svc.SaveChannelPrices(r.Context(), v, id, *channelID, prices); err != nil {
		return err
	}
	return ok(w, object("id", id), "Harga kanal tersimpan")
}

func (h *handler) setDistribution(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	channelID := f.UUID("channel_id", required)
	distributed := f.Bool("is_distributed", required)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.svc.SetDistribution(r.Context(), v, id, *channelID, *distributed); err != nil {
		return err
	}
	msg := "Distribusi dimatikan"
	if *distributed {
		msg = "Ticket didistribusikan"
	}
	return ok(w, object("id", id, "channel_id", *channelID, "is_distributed", *distributed), msg)
}

func (h *handler) addProductDate(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	kind := f.Enum("date_kind", required, DateKinds)
	label := f.Str("label", required, trimmed(1, 120))
	start := f.Str("start_date", required, validate.StrOpts{})
	end := f.Str("end_date", required, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.AddProductDate(r.Context(), v, r.PathValue("id"), *kind, *label, *start, *end)
	if err != nil {
		return err
	}
	return ok(w, row, "Rentang tanggal ditambahkan")
}

func (h *handler) saveProductDateMarks(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	kind := f.Enum("date_kind", required, DateKinds)
	add := f.Strings("add", hasDefault, 100, validate.StrOpts{})
	remove := f.Strings("remove", hasDefault, 100, validate.StrOpts{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	if err := h.svc.SaveProductDateMarks(r.Context(), v, r.PathValue("id"), *kind, add, remove); err != nil {
		return err
	}
	counts := object("added", len(add), "removed", len(remove))
	if len(add)+len(remove) == 0 {
		return ok(w, counts)
	}
	return ok(w, counts, "Kalender tersimpan")
}

func (h *handler) deleteProductDate(w http.ResponseWriter, r *http.Request, v Venue) error {
	dateID := r.PathValue("dateId")
	if err := h.svc.DeleteProductDate(r.Context(), v, r.PathValue("id"), dateID); err != nil {
		return err
	}
	return ok(w, object("id", dateID), "Rentang tanggal dihapus")
}
