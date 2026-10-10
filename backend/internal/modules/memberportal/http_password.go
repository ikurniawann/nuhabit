package memberportal

import (
	"net/http"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/module"
)

// passwordRoutes are password sign-in and management.
func (h *Handler) passwordRoutes() []module.Route {
	return []module.Route{
		{Pattern: "POST " + prefix + "/login", Handler: h.public("Sign-in failed", h.login)},
		{Pattern: "PUT " + prefix + "/password", Handler: h.member("Password could not be saved", h.changePassword)},
		{Pattern: "POST " + prefix + "/password/forgot", Handler: h.public("Password reset could not be started", h.forgotPassword)},
		{Pattern: "POST " + prefix + "/password/reset", Handler: h.public("Password could not be reset", h.resetPassword)},
	}
}

// POST /login { username, password }: username is the WhatsApp number or
// email on the member's account.
func (h *Handler) login(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	password, _ := body["password"].(string)
	signed, err := h.svc.Login(r.Context(), clientIP(r.Header), jsString(body["username"]), password)
	if err != nil {
		return err
	}
	return h.writeSignedIn(w, r, signed)
}

// PUT /password { current_password?, new_password }.
func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	current, _ := body["current_password"].(string)
	next, _ := body["new_password"].(string)
	if err := h.svc.ChangePassword(r.Context(), customerID, sessionToken(r), current, next); err != nil {
		return err
	}
	return success(w)
}

// POST /password/forgot { username }.
func (h *Handler) forgotPassword(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	res, err := h.svc.ForgotPassword(r.Context(), clientIP(r.Header), jsString(body["username"]))
	if err != nil {
		return err
	}
	return ok(w, res)
}

// POST /password/reset { username, code, new_password }.
func (h *Handler) resetPassword(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	next, _ := body["new_password"].(string)
	if err := h.svc.ResetPassword(r.Context(), clientIP(r.Header), jsString(body["username"]), jsString(body["code"]), next); err != nil {
		return err
	}
	return success(w)
}

// sessionToken is the raw member session token of the request: the Bearer
// header first, then the cookie (resolveSessionToken in session.ts).
func sessionToken(r *http.Request) string {
	if token := domain.BearerToken(r.Header.Get("Authorization")); token != "" {
		return token
	}
	if c, err := r.Cookie(domain.SessionCookie); err == nil {
		return c.Value
	}
	return ""
}
