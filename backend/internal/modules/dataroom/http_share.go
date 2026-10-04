package dataroom

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Public share link routes (/api/share/{token}/...). They are not wrapped
// in apiHandler in TS: every refusal is { success: false, error } with
// its status.

// shareContext is resolveShareContext's success.
type shareContext struct {
	share   *Share
	root    *Node
	session *Session
	steps   domain.Steps
}

// resolveShare is resolveShareContext: 404 unknown link, 410 revoked or
// expired, 404 when the shared node is gone; then the recipient session
// from the drs_<token> cookie.
func (h *handler) resolveShare(r *http.Request, token string) (*shareContext, error) {
	ctx := r.Context()
	sh, err := h.svc.shareByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	if sh == nil {
		return nil, httpx.NotFound("Link tidak ditemukan")
	}
	if !domain.IsShareActive(sh.RevokedAt != nil, time.Time(sh.ExpiresAt), h.now()) {
		if sh.RevokedAt != nil {
			return nil, httpx.Status(http.StatusGone, "Link sudah dicabut oleh pemilik")
		}
		return nil, httpx.Status(http.StatusGone, "Link sudah kedaluwarsa")
	}
	root, err := h.svc.Node(ctx, sh.NodeID)
	if err != nil {
		return nil, err
	}
	if root == nil {
		return nil, httpx.NotFound("Berkas sudah dihapus")
	}
	sc := &shareContext{share: sh, root: root}
	if c, err := r.Cookie(domain.SessionCookieName(sh.Token)); err == nil {
		if sc.session, err = h.svc.session(ctx, sh.ID, c.Value); err != nil {
			return nil, err
		}
	}
	sc.steps = h.stepsFor(sh, sc.session)
	return sc, nil
}

func (h *handler) stepsFor(sh *Share, se *Session) domain.Steps {
	emailOK, pinOK := false, false
	if se != nil {
		emailOK, pinOK = se.EmailOK, se.PinOK
	}
	return domain.PendingSteps(sh.AccessType, sh.PinHash != nil && *sh.PinHash != "", emailOK, pinOK)
}

func sessionEmail(se *Session) *string {
	if se == nil {
		return nil
	}
	return se.Email
}

func (h *handler) shareInfo(w http.ResponseWriter, r *http.Request) error {
	sc, err := h.resolveShare(r, r.PathValue("token"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	if sc.session == nil {
		if err := h.svc.touchShare(ctx, sc.share.ID); err != nil {
			return err
		}
		h.svc.logAccess(ctx, accessEvent{shareID: sc.share.ID, action: "open", ip: clientIP(r.Header), userAgent: r.Header.Get("User-Agent")})
	}
	verified := sc.steps.Verified()
	var root *PublicNode
	items := []PublicNode{}
	if verified {
		p := sc.root.Public()
		root = &p
		if sc.root.Kind == "folder" {
			children, err := h.svc.Children(ctx, &sc.root.ID)
			if err != nil {
				return err
			}
			items = publicNodes(children)
		}
	}
	return httpx.Data(w, http.StatusOK, struct {
		Name        string       `json:"name"`
		Kind        string       `json:"kind"`
		AccessType  string       `json:"access_type"`
		RequiresPin bool         `json:"requires_pin"`
		Watermark   bool         `json:"watermark"`
		ExpiresAt   httpx.JSTime `json:"expires_at"`
		SharedBy    *string      `json:"shared_by"`
		Steps       domain.Steps `json:"steps"`
		Verified    bool         `json:"verified"`
		Email       *string      `json:"email"`
		Root        *PublicNode  `json:"root"`
		Items       []PublicNode `json:"items"`
	}{sc.root.Name, sc.root.Kind, sc.share.AccessType, sc.share.PinHash != nil && *sc.share.PinHash != "", sc.share.Watermark,
		sc.share.ExpiresAt, sc.share.CreatedByName, sc.steps, verified, sessionEmail(sc.session), root, items})
}

// failWith writes { success: false, error, data } with status.
func failWith(w http.ResponseWriter, status int, msg string, data any) error {
	return httpx.JSON(w, status, struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
		Data    any    `json:"data"`
	}{false, msg, data})
}

type stepsData struct {
	Steps domain.Steps `json:"steps"`
}

func (h *handler) shareList(w http.ResponseWriter, r *http.Request) error {
	sc, err := h.resolveShare(r, r.PathValue("token"))
	if err != nil {
		return err
	}
	if !sc.steps.Verified() {
		return failWith(w, http.StatusUnauthorized, "Verifikasi dulu", stepsData{sc.steps})
	}
	ctx := r.Context()
	folderID := sc.root.ID
	if f := queryParam(r, "folder"); f != nil {
		folderID = *f
	}
	folder, err := h.svc.Node(ctx, folderID)
	if err != nil {
		return err
	}
	if folder != nil {
		within, err := h.svc.isSameOrDescendant(ctx, folder.ID, sc.share.NodeID)
		if err != nil {
			return err
		}
		if !within {
			folder = nil
		}
	}
	if folder == nil || folder.Kind != "folder" {
		return httpx.NotFound("Folder tidak ditemukan")
	}
	trail, err := h.svc.Ancestors(ctx, folder.ID)
	if err != nil {
		return err
	}
	// ancestors.slice(findIndex(root)): -1 slices to the last entry.
	start := len(trail) - 1
	for i, c := range trail {
		if c.ID == sc.root.ID {
			start = i
			break
		}
	}
	type crumb struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	crumbs := []crumb{}
	for _, c := range trail[max(0, start):] {
		crumbs = append(crumbs, crumb{c.ID, c.Name})
	}
	children, err := h.svc.Children(ctx, &folder.ID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Folder    PublicNode   `json:"folder"`
		Ancestors []crumb      `json:"ancestors"`
		Items     []PublicNode `json:"items"`
	}{folder.Public(), crumbs, publicNodes(children)})
}

// jsonBody is `await request.json().catch(() => ({}))` reduced to its
// object fields (anything else has none).
func jsonBody(r *http.Request) map[string]any {
	body, _ := validate.ReadBody(r)
	m, _ := body.(map[string]any)
	return m
}

// jsString is String(value) for a parsed JSON value ("" for null and
// undefined, as `?? ""` makes it).
func jsString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return t.String()
		}
		return validate.JSNumber(f)
	case []any:
		parts := make([]string, len(t))
		for i, e := range t {
			parts[i] = jsString(e)
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

func (h *handler) requestCode(w http.ResponseWriter, r *http.Request) error {
	token := r.PathValue("token")
	sc, err := h.resolveShare(r, token)
	if err != nil {
		return err
	}
	if sc.share.AccessType != "email" {
		return httpx.BadRequest("Link ini tidak memerlukan verifikasi email")
	}
	ip, ua := clientIP(r.Header), r.Header.Get("User-Agent")
	if err := h.rateLimit(r, "dataroom-code:"+token+":"+ip, 5, "Terlalu banyak permintaan. Coba lagi sebentar."); err != nil {
		return err
	}
	email := strings.ToLower(validate.JSTrim(jsString(jsonBody(r)["email"])))
	if !domain.IsValidEmail(email) {
		return httpx.BadRequest("Email tidak valid")
	}
	ctx := r.Context()
	if !domain.IsEmailAllowed(sc.share.AllowedEmails, email) {
		h.svc.logAccess(ctx, accessEvent{shareID: sc.share.ID, action: "code_failed", email: &email, ip: ip, userAgent: ua})
		return httpx.Forbidden("Email ini tidak termasuk penerima link")
	}
	code, err := h.svc.issueEmailCode(ctx, sc.share.ID, email)
	if err != nil {
		return err
	}
	sent := h.svc.sendShareCode(ctx, email, code, sc.root.Name)
	h.svc.logAccess(ctx, accessEvent{shareID: sc.share.ID, action: "code_sent", email: &email, ip: ip, userAgent: ua})
	if !sent && h.svc.production {
		return httpx.Status(http.StatusBadGateway, "Gagal mengirim email. Hubungi pengirim link.")
	}
	return httpx.Data(w, http.StatusOK, struct {
		Sent bool `json:"sent"`
	}{true})
}

// codeFailure is the 400 message of a failed email code.
func codeFailure(result string) string {
	switch result {
	case "expired":
		return "Kode sudah kedaluwarsa, minta kode baru"
	case "too_many":
		return "Terlalu banyak percobaan, minta kode baru"
	case "missing":
		return "Minta kode verifikasi terlebih dahulu"
	}
	return "Kode salah"
}

type verifyData struct {
	Steps    domain.Steps `json:"steps"`
	Verified bool         `json:"verified"`
}

// verify is POST /api/share/{token}/verify { email?, code?, pin? }: the
// email code and/or the PIN become session progress in a httpOnly cookie.
// PIN failures count per link in auth.attempt_limits (durable, not per IP).
func (h *handler) verify(w http.ResponseWriter, r *http.Request) error {
	token := r.PathValue("token")
	sc, err := h.resolveShare(r, token)
	if err != nil {
		return err
	}
	sh, session, steps := sc.share, sc.session, sc.steps
	ip, ua := clientIP(r.Header), r.Header.Get("User-Agent")
	if err := h.rateLimit(r, "dataroom-verify:"+token+":"+ip, 10, "Terlalu banyak percobaan. Coba lagi sebentar."); err != nil {
		return err
	}
	ctx := r.Context()
	body := jsonBody(r)
	emailVal := body["email"]
	if emailVal == nil && session != nil && session.Email != nil {
		emailVal = *session.Email
	}
	email := strings.ToLower(validate.JSTrim(jsString(emailVal)))
	code := validate.JSTrim(jsString(body["code"]))
	pin := validate.JSTrim(jsString(body["pin"]))
	update := sessionUpdate{ip: ip, userAgent: ua}
	if email != "" {
		update.email = &email
	}

	if steps.NeedEmail {
		if email == "" || !domain.IsEmailAllowed(sh.AllowedEmails, email) {
			return httpx.Forbidden("Email tidak termasuk penerima link")
		}
		if code == "" {
			return httpx.BadRequest("Masukkan kode verifikasi")
		}
		result, err := h.svc.verifyEmailCode(ctx, sh.ID, email, code)
		if err != nil {
			return err
		}
		if result != "ok" {
			h.svc.logAccess(ctx, accessEvent{shareID: sh.ID, action: "code_failed", email: &email, ip: ip, userAgent: ua})
			return httpx.BadRequest(codeFailure(result))
		}
		update.emailOK = true
	}

	if steps.NeedPin {
		if pin == "" {
			if !update.emailOK {
				return httpx.BadRequest("Masukkan PIN")
			}
			// Email passed but no PIN yet: keep the email progress, ask for the PIN.
			s, err := h.svc.upsertSession(ctx, session, sh, update)
			if err != nil {
				return err
			}
			h.setCookie(w, r, sh.Token, s)
			return httpx.Data(w, http.StatusOK, verifyData{h.stepsFor(sh, s), false})
		}
		lock, err := h.svc.pinLock(ctx, sh.ID)
		if err != nil {
			return err
		}
		valid := false
		if lock == nil {
			if valid, err = h.svc.verifyPin(ctx, pin, *sh.PinHash); err != nil {
				return err
			}
		}
		if !valid {
			lockedUntil := lock
			if lock == nil {
				if lockedUntil, err = h.svc.recordPinFailure(ctx, sh.ID); err != nil {
					return err
				}
				var logEmail *string
				if email != "" {
					logEmail = &email
				}
				h.svc.logAccess(ctx, accessEvent{shareID: sh.ID, action: "pin_failed", email: logEmail, ip: ip, userAgent: ua})
			}
			msg, status := "PIN salah", http.StatusBadRequest
			if lockedUntil != nil {
				msg = "Terlalu banyak percobaan PIN. Coba lagi dalam " + strconv.Itoa(domain.MinutesUntil(*lockedUntil, h.now())) + " menit."
				status = http.StatusTooManyRequests
			}
			if update.emailOK {
				s, err := h.svc.upsertSession(ctx, session, sh, update)
				if err != nil {
					return err
				}
				h.setCookie(w, r, sh.Token, s)
				return failWith(w, status, msg, stepsData{h.stepsFor(sh, s)})
			}
			return httpx.Status(status, msg)
		}
		if err := h.svc.clearPinFailures(ctx, sh.ID); err != nil {
			return err
		}
		update.pinOK = true
	}

	s, err := h.svc.upsertSession(ctx, session, sh, update)
	if err != nil {
		return err
	}
	next := h.stepsFor(sh, s)
	if next.Verified() && (update.emailOK || update.pinOK) {
		h.svc.logAccess(ctx, accessEvent{shareID: sh.ID, action: "verified", email: s.Email, ip: ip, userAgent: ua})
	}
	h.setCookie(w, r, sh.Token, s)
	return httpx.Data(w, http.StatusOK, verifyData{next, next.Verified()})
}

// setCookie is the route's setCookie: httpOnly, SameSite=Lax, Path=/,
// Secure per httpx.SecureRequest, expiring with the session.
func (h *handler) setCookie(w http.ResponseWriter, r *http.Request, shareToken string, s *Session) {
	http.SetCookie(w, &http.Cookie{
		Name: domain.SessionCookieName(shareToken), Value: s.SessionToken, Path: "/", Expires: s.ExpiresAt,
		HttpOnly: true, Secure: httpx.SecureRequest(r), SameSite: http.SameSiteLaxMode,
	})
}

// clientIP is lib/security/client-ip: cf-connecting-ip (set by the
// Cloudflare edge), then the left-most x-forwarded-for, then x-real-ip.
func clientIP(h http.Header) string {
	if ip := strings.TrimSpace(h.Get("cf-connecting-ip")); ip != "" {
		return ip
	}
	if first := strings.TrimSpace(strings.Split(h.Get("x-forwarded-for"), ",")[0]); first != "" {
		return first
	}
	if ip := strings.TrimSpace(h.Get("x-real-ip")); ip != "" {
		return ip
	}
	return "unknown"
}
