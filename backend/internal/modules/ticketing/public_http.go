package ticketing

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/validate"
)

// The public booking routes (/api/public/booking/**): no auth, a per-IP
// sliding-window rate limit on every route, generic 404s for unknown slugs
// and tokens (anti-enumeration), and the Xendit webhook behind
// x-callback-token.

type publicHandler struct {
	svc     *Service
	limiter *ratelimit.Limiter
}

// publicRoutes lists the public booking routes.
//
// GET /api/public/booking/{slug}/catalog (and availability, slots, passes)
// overlap in ServeMux with GET /api/public/booking/status/{token} and
// /pass-status/{token}, so one dispatcher serves them all, the static
// "status" and "pass-status" segments winning as in the Next app router.
func (h *handler) publicRoutes() []module.Route {
	p := &publicHandler{svc: h.svc, limiter: ratelimit.New(h.svc.db)}
	return []module.Route{
		{Pattern: "POST /api/public/booking/{slug}", Handler: httpx.Handle(p.createBooking)},
		{Pattern: "GET /api/public/booking/{a}/{b}", Handler: httpx.Handle(p.get)},
		{Pattern: "POST /api/public/booking/{slug}/pass", Handler: httpx.Handle(p.purchasePass)},
		{Pattern: "POST /api/public/booking/{slug}/promo-check", Handler: httpx.Handle(p.promoCheck)},
		{Pattern: "POST /api/public/booking/webhook/xendit", Handler: httpx.Handle(p.webhook)},
	}
}

const tooManyRequests = "Terlalu banyak permintaan — coba lagi sebentar"

// limit is assertPublicRateLimit.
func (p *publicHandler) limit(r *http.Request, bucket string, max int, window time.Duration, msg string) error {
	allowed, _, err := p.limiter.Sliding(r.Context(), bucket+":"+domain.ClientIP(r.Header), max, window, p.svc.now())
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.Status(http.StatusTooManyRequests, msg)
	}
	return nil
}

func (p *publicHandler) venue(r *http.Request, slug string) (*PublicVenue, error) {
	v, err := p.svc.resolvePublicVenue(r.Context(), slug)
	if err == nil && v == nil {
		return nil, httpx.NotFound(notFound)
	}
	return v, err
}

// get dispatches the GET routes sharing /api/public/booking/{a}/{b}.
func (p *publicHandler) get(w http.ResponseWriter, r *http.Request) error {
	a, b := r.PathValue("a"), r.PathValue("b")
	switch {
	case a == "status":
		return p.bookingStatus(w, r, b)
	case a == "pass-status":
		return p.passStatus(w, r, b)
	case b == "catalog":
		return p.catalog(w, r, a)
	case b == "availability":
		return p.availability(w, r, a)
	case b == "slots":
		return p.slots(w, r, a)
	case b == "passes":
		return p.passes(w, r, a)
	}
	http.NotFound(w, r)
	return nil
}

func (p *publicHandler) catalog(w http.ResponseWriter, r *http.Request, slug string) error {
	if err := p.limit(r, "booking-catalog", 30, time.Minute, tooManyRequests); err != nil {
		return err
	}
	date := r.URL.Query().Get("date")
	if msg := domain.VisitDateWindowError(date, p.svc.today()); msg != "" {
		return httpx.BadRequest(msg)
	}
	v, err := p.venue(r, slug)
	if err != nil {
		return err
	}
	products, err := p.svc.buildPublicCatalog(r.Context(), v, date)
	if err != nil {
		return err
	}
	return ok(w, object("visit_date", date, "venue", object("name", v.VenueName), "products", products))
}

const maxAvailabilityDays = 92

func (p *publicHandler) availability(w http.ResponseWriter, r *http.Request, slug string) error {
	if err := p.limit(r, "booking-availability", 30, time.Minute, tooManyRequests); err != nil {
		return err
	}
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	if msg := domain.DateRangeError(from, to, maxAvailabilityDays); msg != "" {
		return httpx.BadRequest(msg)
	}
	v, err := p.venue(r, slug)
	if err != nil {
		return err
	}
	dates, err := p.svc.availability(r.Context(), v.Venue, from, to)
	if err != nil {
		return err
	}
	return ok(w, object("dates", dates))
}

type slotView struct {
	SlotID    string `json:"slot_id"`
	Label     string `json:"label"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Status    string `json:"status"`
}

func (p *publicHandler) slots(w http.ResponseWriter, r *http.Request, slug string) error {
	if err := p.limit(r, "booking-slots", 30, time.Minute, tooManyRequests); err != nil {
		return err
	}
	date := r.URL.Query().Get("date")
	if domain.ValidateVisitDateWindow(date, p.svc.today()) != domain.WindowOK {
		return httpx.BadRequest("Tanggal tidak valid")
	}
	v, err := p.venue(r, slug)
	if err != nil {
		return err
	}
	ctx := r.Context()
	slots, err := loadActiveSlots(ctx, p.svc.db, v.Venue)
	if err != nil {
		return err
	}
	views := []slotView{}
	if len(slots) > 0 {
		used, err := countSlotUsedByDate(ctx, p.svc.db, v.Venue, date)
		if err != nil {
			return err
		}
		for _, s := range slots {
			status := "available"
			if s.Capacity != nil && used[s.ID] >= *s.Capacity {
				status = "sold_out"
			}
			views = append(views, slotView{s.ID, s.Label, clock(s.StartTime), clock(s.EndTime), status})
		}
	}
	return ok(w, object("slots", views))
}

func (p *publicHandler) passes(w http.ResponseWriter, r *http.Request, slug string) error {
	if err := p.limit(r, "pass-catalog", 30, time.Minute, tooManyRequests); err != nil {
		return err
	}
	v, err := p.venue(r, slug)
	if err != nil {
		return err
	}
	passes, err := p.svc.OnlinePasses(r.Context(), v.Venue)
	if err != nil {
		return err
	}
	return ok(w, object("venue", object("name", v.VenueName), "passes", passes))
}

var tokenPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (p *publicHandler) bookingStatus(w http.ResponseWriter, r *http.Request, token string) error {
	if err := p.limit(r, "booking-status", 30, time.Minute, tooManyRequests); err != nil {
		return err
	}
	var status *Row
	if tokenPattern.MatchString(token) {
		var err error
		if status, err = p.svc.PublicBookingStatus(r.Context(), token); err != nil {
			return err
		}
	}
	if status == nil {
		return httpx.NotFound(notFound)
	}
	return ok(w, status)
}

func (p *publicHandler) passStatus(w http.ResponseWriter, r *http.Request, token string) error {
	if err := p.limit(r, "pass-status", 30, time.Minute, tooManyRequests); err != nil {
		return err
	}
	var status *Row
	if tokenPattern.MatchString(token) {
		var err error
		if status, err = p.svc.PassStatus(r.Context(), token); err != nil {
			return err
		}
	}
	if status == nil {
		return httpx.NotFound(notFound)
	}
	return ok(w, status)
}

const tooManyAttempts = "Terlalu banyak percobaan — coba lagi beberapa menit lagi"

// requestOrigin is appOrigin(request): the configured origin, else the
// public origin the proxy forwarded.
func requestOrigin(r *http.Request, configured string) string {
	if configured != "" {
		return configured
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-proto"), ",")[0]); proto != "" {
		scheme = proto
	}
	host := strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-host"), ",")[0])
	if host == "" {
		host = r.Host
	}
	return strings.TrimRight(scheme+"://"+host, "/")
}

func (p *publicHandler) createBooking(w http.ResponseWriter, r *http.Request) error {
	if err := p.limit(r, "booking-create", 5, 5*time.Minute, tooManyAttempts); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := parseBooking(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	res, err := p.svc.CreatePublicBooking(r.Context(), r.PathValue("slug"), in, requestOrigin(r, p.svc.ports.AppOrigin))
	if err != nil {
		return err
	}
	return ok(w, res, "Booking dibuat — selesaikan pembayaran")
}

// parseBooking is createBookingSchema.
func parseBooking(f *validate.Form) BookingInput {
	var in BookingInput
	req, opt := validate.Rule{}, validate.Rule{Optional: true}
	in.VisitDate = deref(f.Str("visit_date", req, validate.StrOpts{}))
	in.CustomerName = deref(f.Str("customer_name", req, trimmed(2, 120)))
	in.CustomerPhone = deref(f.Str("customer_phone", req, trimmed(8, 25)))
	in.SlotID = f.UUID("slot_id", opt)
	in.PromoCode = f.Str("promo_code", opt, trimmed(3, 40))
	in.GiftRecipientName = f.Str("gift_recipient_name", opt, trimmed(2, 120))
	in.GiftRecipientPhone = f.Str("gift_recipient_phone", opt, trimmed(8, 25))
	items := f.List("items", req, 10, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		item := domain.CartItem{VariantID: deref(it.UUID("variant_id", req))}
		item.Qty = deref(it.Int("qty", req, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(domain.BookingMaxQty)}))
		it.List("guest_names", opt, domain.BookingMaxQty, func(names *validate.Form, j int, v any) {
			if v == nil {
				item.GuestNames = append(item.GuestNames, nil)
				return
			}
			name, _ := names.CheckString(j, v, validate.StrOpts{Trim: true, Max: domain.GuestNameMaxLength})
			item.GuestNames = append(item.GuestNames, &name)
		})
		in.Items = append(in.Items, item)
	})
	if items != nil && len(items) == 0 {
		f.Fail("items", "too_small", "Too small: expected array to have >=1 items")
	}
	return in
}

func (p *publicHandler) purchasePass(w http.ResponseWriter, r *http.Request) error {
	if err := p.limit(r, "pass-create", 5, 5*time.Minute, tooManyAttempts); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	req := validate.Rule{}
	in := PassPurchase{
		TicketProductID: deref(f.UUID("ticket_product_id", req)),
		HolderName:      deref(f.Str("holder_name", req, trimmed(2, 120))),
		HolderPhone:     deref(f.Str("holder_phone", req, trimmed(8, 25))),
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	res, err := p.svc.PurchasePassOnline(r.Context(), r.PathValue("slug"), in, requestOrigin(r, p.svc.ports.AppOrigin))
	if err != nil {
		return err
	}
	return ok(w, res, "Pass dibuat — selesaikan pembayaran")
}

type promoOK struct {
	OK           bool    `json:"ok"`
	Discount     float64 `json:"discount"`
	CampaignName string  `json:"campaign_name"`
	DiscountType string  `json:"discount_type"`
}

type promoRejected struct {
	OK      bool   `json:"ok"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

// promoCheck is the wizard's indicative promo validation (read-only, no
// claim); the strict limit slows code guessing.
func (p *publicHandler) promoCheck(w http.ResponseWriter, r *http.Request) error {
	if err := p.limit(r, "promo-check", 15, time.Minute, "Terlalu banyak percobaan — coba lagi sebentar"); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	code := f.Str("code", validate.Rule{}, trimmed(3, 40))
	subtotal := f.Num("subtotal", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)})
	phone := f.Str("phone", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 25})
	if !f.Valid() {
		// A public endpoint does not leak its schema: no issue details.
		return httpx.BadRequest("Validation failed")
	}
	v, err := p.venue(r, r.PathValue("slug"))
	if err != nil {
		return err
	}
	var digits *string
	if phone != nil {
		if d := domain.NormalizePhoneDigits(*phone); d != "" {
			digits = &d
		}
	}
	preview, err := p.svc.ports.Public.Promo.Preview(r.Context(), p.svc.db, PromoCheck{
		CompanyID: v.CompanyID, BranchID: v.BranchID, Code: *code, Channel: "ticketing_online",
		Subtotal: *subtotal, Phone: digits,
	})
	if err != nil {
		return err
	}
	if preview.OK {
		return ok(w, promoOK{true, preview.Discount, preview.CampaignName, preview.DiscountType})
	}
	return ok(w, promoRejected{false, preview.Reason, preview.Message})
}

// ParseInvoiceCallback is xenditCallbackSchema; ok is false when the
// payload does not match.
func ParseInvoiceCallback(raw any) (InvoiceCallback, bool) {
	f := validate.New(raw, true)
	req := validate.Rule{}
	cb := InvoiceCallback{
		ID:         deref(f.Str("id", req, validate.StrOpts{})),
		ExternalID: deref(f.Str("external_id", req, validate.StrOpts{})),
		Status:     deref(f.Str("status", req, validate.StrOpts{})),
		PaidAt:     f.Str("paid_at", validate.Rule{Optional: true}, validate.StrOpts{}),
		Amount:     f.Num("amount", validate.Rule{Optional: true}, validate.NumOpts{}),
	}
	return cb, f.Valid()
}

// webhook is the bookings' and passes' Xendit invoice webhook. A valid
// callback is always acknowledged 200 (ignored ones included); a failure
// is a 500 so Xendit retries.
func (p *publicHandler) webhook(w http.ResponseWriter, r *http.Request) error {
	// A coarse per-IP brake, loose enough for Xendit's retry bursts.
	if err := p.limit(r, "booking-webhook", 120, time.Minute, "Too many requests"); err != nil {
		return err
	}
	if !p.svc.ports.Public.Payments.ValidWebhookToken(r.Header.Get("x-callback-token")) {
		return httpx.Unauthorized("Unauthorized")
	}
	body, present := validate.ReadBody(r)
	if !present {
		return errBodyNotJSON
	}
	cb, valid := ParseInvoiceCallback(body)
	if !valid {
		return httpx.BadRequest("Payload tidak dikenal")
	}
	res, err := p.svc.SettleInvoice(r.Context(), nil, cb)
	if err != nil {
		p.svc.log.Error("[booking] webhook error", "error", err)
		return httpx.Status(http.StatusInternalServerError, "Webhook gagal diproses")
	}
	return httpx.JSON(w, http.StatusOK, res)
}
