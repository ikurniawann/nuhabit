package ticketing

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/url"
	"slices"
	"time"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
}

type handler struct {
	svc     *Service
	guard   Guard
	venues  Venues
	limiter *ratelimit.Limiter
	now     func() time.Time
}

// Routes lists every /api/ticketing route, each guarded by the sub-modules
// whose dashboard pages call it. Voiding a charge stays with the reports
// menu, as before: the loket shows the button but only supervisors pass.
func (h *handler) Routes() []module.Route {
	booking, loket, gate, gatePass := iam.TicketingBooking, iam.TicketingLoket, iam.TicketingGate, iam.TicketingGatePass
	passes, tickets, mapping := iam.TicketingPasses, iam.TicketingTickets, iam.TicketingMapping
	channels, settings, reports := iam.TicketingChannelManager, iam.TicketingSettings, iam.TicketingReports
	r := func(pattern string, menus []string, fn venueFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: h.venue(menus, fn)}
	}
	return []module.Route{
		r("GET /api/ticketing/bookings", booking, h.listBookings),
		r("GET /api/ticketing/bookings/lookup", loket, h.lookupBooking),
		r("GET /api/ticketing/bookings/{id}", booking, h.bookingDetail),
		r("PATCH /api/ticketing/bookings/{id}", booking, h.updateBookingNotes),
		r("POST /api/ticketing/bookings/{id}/cancel", booking, h.cancelBooking),
		r("POST /api/ticketing/bookings/{id}/redeem", loket, h.redeemBooking),
		r("POST /api/ticketing/bookings/{id}/resend-wa", booking, h.resendBookingWa),

		r("POST /api/ticketing/gate/tap", gate, h.gateTap),
		r("POST /api/ticketing/gate/pass-tap", gatePass, h.passTap),

		r("GET /api/ticketing/visits", loket, h.listVisits),
		r("POST /api/ticketing/visits", loket, h.registerVisit),
		r("GET /api/ticketing/visits/{id}", loket, h.visitDetail),
		r("POST /api/ticketing/visits/{id}/deposit", loket, h.topUpDeposit),
		r("POST /api/ticketing/visits/{id}/settle", loket, h.settleVisit),
		r("POST /api/ticketing/visits/{id}/charges/{chargeId}/void", reports, h.voidCharge),
		r("POST /api/ticketing/visits/{id}/bands/{bandId}/lost", loket, h.markBandLost),

		r("GET /api/ticketing/season-passes", passes, h.listSeasonPasses),
		r("POST /api/ticketing/season-passes", passes, h.issueSeasonPass),
		r("GET /api/ticketing/season-passes/pass-options", passes, h.passOptions),
		r("POST /api/ticketing/season-passes/{id}/renew", passes, h.renewSeasonPass),

		r("POST /api/ticketing/tab/check", iam.PosCashier, h.tabCheck),
		r("GET /api/ticketing/tab/stats", loket, h.tabStats),
		r("GET /api/ticketing/occupancy", slices.Concat(booking, settings, reports), h.occupancy),
		r("GET /api/ticketing/reports", reports, h.report),

		r("GET /api/ticketing/time-slots", settings, h.listTimeSlots),
		r("POST /api/ticketing/time-slots", settings, h.createTimeSlot),
		r("PATCH /api/ticketing/time-slots/{id}", settings, h.updateTimeSlot),
		r("DELETE /api/ticketing/time-slots/{id}", settings, h.deleteTimeSlot),
		r("GET /api/ticketing/capacity-dates", settings, h.listCapacityDates),
		r("POST /api/ticketing/capacity-dates", settings, h.createCapacityDate),
		r("PATCH /api/ticketing/capacity-dates/{id}", settings, h.updateCapacityDate),
		r("DELETE /api/ticketing/capacity-dates/{id}", settings, h.deleteCapacityDate),
		r("GET /api/ticketing/settings", slices.Concat(settings, loket), h.getSettings),
		r("PUT /api/ticketing/settings", settings, h.updateSettings),
		r("GET /api/ticketing/channels", settings, h.listChannels),
		r("PATCH /api/ticketing/channels/{id}", settings, h.updateChannel),
		r("GET /api/ticketing/categories", tickets, h.listCategories),
		r("POST /api/ticketing/categories", tickets, h.createCategory),

		r("GET /api/ticketing/bands", settings, h.listBands),
		r("POST /api/ticketing/bands", settings, h.registerBand),
		r("PATCH /api/ticketing/bands/{id}", settings, h.updateBand),
		r("GET /api/ticketing/staff-passes", settings, h.listStaffPasses),
		r("POST /api/ticketing/staff-passes", settings, h.pairStaffPass),
		r("DELETE /api/ticketing/staff-passes/{id}", settings, h.revokeStaffPass),

		r("GET /api/ticketing/channel-manager", slices.Concat(channels, tickets), h.channelBoard),
		r("GET /api/ticketing/products", slices.Concat(tickets, mapping), h.listProducts),
		r("POST /api/ticketing/products", tickets, h.createProduct),
		r("GET /api/ticketing/products/loket-options", loket, h.loketOptions),
		r("GET /api/ticketing/products/{id}", tickets, h.productDetail),
		r("PATCH /api/ticketing/products/{id}", tickets, h.updateProduct),
		r("POST /api/ticketing/products/{id}/thumbnail", tickets, h.uploadThumbnail),
		r("PUT /api/ticketing/products/{id}/bundle-items", tickets, h.saveBundleItems),
		r("PUT /api/ticketing/products/{id}/channel-prices", channels, h.saveChannelPrices),
		r("PATCH /api/ticketing/products/{id}/channels", channels, h.setDistribution),
		r("POST /api/ticketing/products/{id}/dates", tickets, h.addProductDate),
		r("POST /api/ticketing/products/{id}/dates/bulk", tickets, h.saveProductDateMarks),
		r("DELETE /api/ticketing/products/{id}/dates/{dateId}", tickets, h.deleteProductDate),
	}
}

type venueFunc func(w http.ResponseWriter, r *http.Request, v Venue) error

const venueNotConfigured = "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user"

// venue is ticketingContext: IAM menu grant, then the venue (fail closed).
func (h *handler) venue(menus []string, fn venueFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, err := h.guard.RequireMenuPrefix(r, menus...)
		if err != nil {
			return err
		}
		companyID, branchID, err := h.venues.Resolve(r.Context(), user.ID)
		if err != nil {
			return err
		}
		if companyID == "" || branchID == "" {
			return httpx.BadRequest(venueNotConfigured)
		}
		return fn(w, r, Venue{UserID: user.ID, CompanyID: companyID, BranchID: branchID})
	})
}

// limit is assertStaffRateLimit: per user and bucket, one-minute window
// shared by every replica.
func (h *handler) limit(ctx context.Context, v Venue, bucket string, max int, msg string) error {
	w, err := h.limiter.Fixed(ctx, bucket+":"+v.UserID, max, time.Minute, h.now())
	if err != nil {
		return err
	}
	if !w.Allowed {
		return httpx.Status(http.StatusTooManyRequests, msg)
	}
	return nil
}

// ok is successResponse(data[, message]).
func ok(w http.ResponseWriter, data any, msg ...string) error {
	if len(msg) > 0 && msg[0] != "" {
		return httpx.DataMessage(w, http.StatusOK, data, msg[0])
	}
	return httpx.Data(w, http.StatusOK, data)
}

type pageMeta struct {
	Page       float64 `json:"page"`
	Limit      float64 `json:"limit"`
	Total      int     `json:"total"`
	TotalPages float64 `json:"totalPages"`
}

// paginated is paginatedResponse(items, pageMeta(page, limit, total)).
func paginated(w http.ResponseWriter, items any, page, limit float64, total int) error {
	return httpx.JSON(w, http.StatusOK, struct {
		Success    bool     `json:"success"`
		Data       any      `json:"data"`
		Pagination pageMeta `json:"pagination"`
	}{true, items, pageMeta{page, limit, total, math.Ceil(float64(total) / limit)}})
}

// readPage is readPage: page >= 1, limit 1..max (default 20), with JS
// Number() semantics (NaN falls back to the default).
func readPage(q url.Values, max float64) (page, limit float64) {
	page = domain.JSNumber(q.Get("page"))
	if math.IsNaN(page) || page == 0 {
		page = 1
	}
	page = math.Max(1, page)
	limit = domain.JSNumber(q.Get("limit"))
	if math.IsNaN(limit) || limit == 0 {
		limit = 20
	}
	return page, math.Min(max, math.Max(1, limit))
}

// errBodyNotJSON is what request.json() throws on a missing or malformed
// body; the TS routes let it through apiHandler as a 500.
var errBodyNotJSON = errors.New("ticketing: request body is not valid JSON")

// readForm is the request.json() step of validateBody / safeParse.
func readForm(r *http.Request) (*validate.Form, error) {
	body, present := validate.ReadBody(r)
	if !present {
		return nil, errBodyNotJSON
	}
	return validate.New(body, true), nil
}

// trimmedOr is `value?.trim() || fallback` for an already trimmed field.
func trimmedOr(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}

// orNil is `value || null`.
func orNil(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	return value
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}
