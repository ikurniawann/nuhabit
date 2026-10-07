package memberportal

import (
	"net/http"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/httpx"
)

type otpSentBody struct {
	Success     bool   `json:"success"`
	Message     string `json:"message,omitempty"`
	WADelivered bool   `json:"wa_delivered"`
	DevBypass   bool   `json:"dev_bypass"`
}

// POST /otp { phone } sends a WhatsApp login code to a registered member.
func (h *Handler) requestOTP(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	issued, err := h.svc.RequestLoginOTP(r.Context(), clientIP(r.Header), body["phone"])
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, otpSentBody{
		Success: true, Message: "Kode OTP dikirim ke WhatsApp Anda",
		WADelivered: issued.WADelivered, DevBypass: issued.DevBypass,
	})
}

// POST /register/otp { phone } is step one of self registration.
func (h *Handler) requestRegisterOTP(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	issued, err := h.svc.RequestRegisterOTP(r.Context(), clientIP(r.Header), body["phone"])
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, otpSentBody{Success: true, WADelivered: issued.WADelivered, DevBypass: issued.DevBypass})
}

type signedInData struct {
	Name  *string `json:"name"`
	Token string  `json:"token,omitempty"`
}

// writeSignedIn sets the session cookie; the native app (x-app-client: 1)
// also gets the token in the body because it cannot read httpOnly cookies.
func (h *Handler) writeSignedIn(w http.ResponseWriter, r *http.Request, s *SignedIn) error {
	data := signedInData{Name: s.Name}
	if r.Header.Get("x-app-client") == "1" {
		data.Token = s.Token
	}
	http.SetCookie(w, sessionCookie(r, s.Token, h.svc.now(), domain.SessionTTL))
	return ok(w, data)
}

// POST /verify { phone, code } opens a member session.
func (h *Handler) verify(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	signed, err := h.svc.Verify(r.Context(), clientIP(r.Header), body["phone"], jsString(body["code"]))
	if err != nil {
		return err
	}
	return h.writeSignedIn(w, r, signed)
}

// POST /register { phone, code, name, email?, birth_date?, wa_consent }.
func (h *Handler) register(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	signed, err := h.svc.Register(r.Context(), clientIP(r.Header), body)
	if err != nil {
		return err
	}
	return h.writeSignedIn(w, r, signed)
}

type googleSignedIn struct {
	Status string  `json:"status"`
	Name   *string `json:"name"`
	Token  string  `json:"token,omitempty"`
}

type googleNeedsPhone struct {
	Status    string `json:"status"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	GoogleSub string `json:"google_sub"`
	Ticket    string `json:"ticket"`
}

// POST /auth/google { id_token }: a member with that verified email signs
// in; anyone else gets a ticket to finish registration with a phone.
func (h *Handler) googleSignIn(w http.ResponseWriter, r *http.Request) error {
	body, _ := readBody(r)
	res, err := h.svc.GoogleSignIn(r.Context(), clientIP(r.Header), jsString(body["id_token"]))
	if err != nil {
		return err
	}
	if res.SignedIn == nil {
		t := res.Ticket
		return ok(w, googleNeedsPhone{Status: "needs_phone", Email: t.Email, Name: t.Name, GoogleSub: t.Sub, Ticket: res.TicketValue})
	}
	data := googleSignedIn{Status: "signed_in", Name: res.SignedIn.Name}
	if r.Header.Get("x-app-client") == "1" {
		data.Token = res.SignedIn.Token
	}
	http.SetCookie(w, sessionCookie(r, res.SignedIn.Token, h.svc.now(), domain.SessionTTL))
	return ok(w, data)
}

// POST /logout ends the session and clears the cookie, even on failure.
func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	token := domain.BearerToken(r.Header.Get("Authorization"))
	if token == "" {
		if c, err := r.Cookie(domain.SessionCookie); err == nil {
			token = c.Value
		}
	}
	if err := h.svc.Logout(r.Context(), token); err != nil {
		h.log.Error("Error destroying member session", "error", err.Error())
	}
	http.SetCookie(w, &http.Cookie{Name: domain.SessionCookie, Value: "", Path: "/", MaxAge: -1})
	_ = httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
	}{true})
}

// GET /me.
func (h *Handler) me(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Me(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// PUT /consent { enabled }.
func (h *Handler) consent(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	enabled, isBool := body["enabled"].(bool)
	if !isBool {
		return fail(400, "Data tidak valid")
	}
	optIn, err := h.svc.SetConsent(r.Context(), customerID, enabled)
	if err != nil {
		return err
	}
	return ok(w, map[string]bool{"marketing_opt_in": optIn})
}
