package memberportal

import (
	"log/slog"
	"net/http"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/module"
)

// Handler is the HTTP transport of the member portal.
type Handler struct {
	svc     *Service
	auth    *auth.Service
	log     *slog.Logger
	credits CreditWallet
}

// memberFunc handles a request of a signed-in member.
type memberFunc func(w http.ResponseWriter, r *http.Request, customerID string) error

// member mirrors withMemberSession: 401 without a session, the route's
// failMessage as a 500 when anything unexpected fails.
func (h *Handler) member(failMessage string, fn memberFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		customerID, err := h.auth.RequireMember(r)
		if err == nil {
			err = fn(w, r, customerID)
		}
		if err != nil {
			writeFailure(w, r, h.log, err, failMessage)
		}
	})
}

// public handles a request without a member session.
func (h *Handler) public(failMessage string, fn func(w http.ResponseWriter, r *http.Request) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			writeFailure(w, r, h.log, err, failMessage)
		}
	})
}

const prefix = "/api/member-portal"

// Routes lists every ported member portal route.
func (h *Handler) Routes() []module.Route {
	routes := []module.Route{
		// Sign-in, registration, session
		{Pattern: "POST " + prefix + "/otp", Handler: h.public("Gagal mengirim OTP", h.requestOTP)},
		{Pattern: "POST " + prefix + "/register/otp", Handler: h.public("Gagal mengirim OTP", h.requestRegisterOTP)},
		{Pattern: "POST " + prefix + "/verify", Handler: h.public("Gagal verifikasi OTP", h.verify)},
		{Pattern: "POST " + prefix + "/register", Handler: h.public("Pendaftaran gagal. Coba lagi.", h.register)},
		{Pattern: "POST " + prefix + "/logout", Handler: http.HandlerFunc(h.logout)},

		// Profile and account
		{Pattern: "GET " + prefix + "/me", Handler: h.member("Gagal memuat profil", h.me)},
		{Pattern: "PUT " + prefix + "/profile", Handler: h.member("Gagal menyimpan profil", h.updateProfile)},
		{Pattern: "POST " + prefix + "/profile/photo", Handler: h.member("Gagal mengunggah foto", h.uploadPhoto)},
		{Pattern: "PUT " + prefix + "/consent", Handler: h.member("Gagal menyimpan pilihan promo", h.consent)},
		{Pattern: "GET " + prefix + "/visits", Handler: h.member("Gagal memuat riwayat kunjungan", h.visits)},
		{Pattern: "GET " + prefix + "/transactions", Handler: h.member("Gagal memuat riwayat", h.transactions)},
		{Pattern: "GET " + prefix + "/orders/{id}", Handler: h.member("Gagal memuat detail order", h.orderDetail)},

		// Inbox, push, QR
		{Pattern: "GET " + prefix + "/notifications", Handler: h.member("Gagal memuat notifikasi", h.notifications)},
		{Pattern: "POST " + prefix + "/notifications", Handler: h.member("Gagal menandai notifikasi", h.markNotifications)},
		{Pattern: "POST " + prefix + "/notifications/track", Handler: h.member("Gagal mencatat notifikasi", h.trackNotification)},
		{Pattern: "GET " + prefix + "/push", Handler: h.member("Gagal memuat status notifikasi", h.pushStatus)},
		{Pattern: "POST " + prefix + "/push", Handler: h.member("Gagal menyalakan notifikasi", h.pushSubscribe)},
		{Pattern: "DELETE " + prefix + "/push", Handler: h.member("Gagal mematikan notifikasi", h.pushUnsubscribe)},
		{Pattern: "POST " + prefix + "/qr", Handler: h.member("Gagal membuat QR", h.issueQR)},

		// Member app home
		{Pattern: "GET " + prefix + "/app/home", Handler: h.member("Gagal memuat beranda", h.homeFeed)},
		{Pattern: "GET " + prefix + "/app/home/bookings", Handler: h.member("Gagal memuat booking", h.homeBookings)},
		{Pattern: "GET " + prefix + "/app/home/visits", Handler: h.member("Gagal memuat riwayat kunjungan", h.homeVisits)},
		{Pattern: "GET " + prefix + "/app/home/announcements/{id}", Handler: h.member("Gagal memuat pengumuman", h.homeAnnouncement)},
		{Pattern: "PATCH " + prefix + "/app/home/me", Handler: h.member("Gagal menyimpan akun", h.saveAccount)},
	}
	if h.credits != nil {
		routes = append(routes, module.Route{Pattern: "GET " + prefix + "/app/home/me", Handler: h.member("Gagal memuat akun", h.account)})
	}
	routes = append(routes, h.engagementRoutes()...)
	routes = append(routes, h.collectionRoutes()...)
	routes = append(routes, h.topupRoutes()...)
	return routes
}

// bypassFromEnv builds the dev-bypass guard from the live environment.
func bypassFromEnv(production bool, getenv func(string) string, databaseURL string) func() domain.DevBypass {
	return func() domain.DevBypass {
		url := getenv("DATABASE_URL")
		if url == "" {
			url = databaseURL
		}
		return domain.DevBypass{Production: production, Code: getenv("MEMBER_OTP_DEV_CODE"), DatabaseURL: url}
	}
}
