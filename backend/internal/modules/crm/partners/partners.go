package partners

import (
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/partners/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

var (
	required = validate.Rule{}
	optional = validate.Rule{Optional: true}
	xpBounds = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(domain.PartnerXPCap)}
)

// publicColumns never include the secret itself (PARTNER_PUBLIC_COLUMNS).
const publicColumns = `p.id, p.code, p.name, p.partner_type, p.is_active, p.awards_xp,
  p.xp_per_event, p.secret_rotated_at, p.created_at, p.updated_at,
  (p.signing_secret IS NOT NULL) AS has_secret`

// listPartners lists partners with event counts per status.
func (h *handler) listPartners(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GatePartners); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT `+publicColumns+`,
            count(e.id)::int AS event_count,
            count(e.id) FILTER (WHERE e.processing_status = 'processed')::int AS processed_count,
            count(e.id) FILTER (WHERE e.processing_status IN ('unmatched', 'failed'))::int AS pending_count,
            COALESCE(sum(e.xp_awarded), 0)::int AS xp_total,
            max(e.received_at) AS last_event_at
       FROM crm.crm_integration_partners p
       LEFT JOIN crm.crm_external_events e ON e.partner_id = p.id
      GROUP BY p.id
      ORDER BY p.name`)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

var codeRe = regexp.MustCompile(`^[A-Za-z0-9_-]{2,40}$`)

func codeCheck(s string) (string, string, bool) {
	return "invalid_format", "Kode 2–40 karakter: huruf, angka, - atau _", codeRe.MatchString(s)
}

// createPartner creates a partner with a server-made secret, returned once.
func (h *handler) createPartner(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GatePartners); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	code := f.Str("code", required, validate.StrOpts{Trim: true, Check: codeCheck})
	name := f.Str("name", required, validate.StrOpts{Trim: true, Min: 2, Max: 120})
	partnerType := f.Enum("partner_type", required, domain.PartnerTypes)
	awardsXP := f.BoolDefault("awards_xp", false)
	xpPerEvent := 0
	if n := f.Int("xp_per_event", validate.Rule{HasDefault: true}, xpBounds); n != nil {
		xpPerEvent = *n
	}
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	secret, err := domain.GenerateSecret()
	if err != nil {
		return err
	}
	out := struct {
		ID     string `json:"id"`
		Code   string `json:"code"`
		Secret string `json:"secret"`
	}{Secret: secret}
	err = h.db.QueryRow(r.Context(), `INSERT INTO crm.crm_integration_partners
       (code, name, partner_type, awards_xp, xp_per_event, signing_secret, secret_hash, secret_rotated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (code) DO NOTHING
     RETURNING id::text, code`,
		strings.ToUpper(*code), *name, *partnerType, awardsXP, xpPerEvent, secret, domain.HashSecret(secret)).Scan(&out.ID, &out.Code)
	if database.IsNoRows(err) {
		return httpx.Conflict("Kode partner sudah dipakai")
	}
	if err != nil {
		return err
	}
	return kit.OK(w, out, "Partner dibuat")
}

// updatePartner edits a partner or rotates its secret (the new secret is
// returned once; the old one stops working at once).
func (h *handler) updatePartner(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GatePartners); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	name := f.Str("name", optional, validate.StrOpts{Trim: true, Min: 2, Max: 120})
	isActive := f.Bool("is_active", optional)
	awardsXP := f.Bool("awards_xp", optional)
	xpPerEvent := f.Int("xp_per_event", optional, xpBounds)
	// z.literal(true).optional(): anything sent but true (null included) fails.
	rotate := false
	if v, sent := f.Fields()["rotate_secret"]; sent {
		if v != true {
			f.Fail("rotate_secret", "invalid_value", "Invalid input: expected true")
		}
		rotate = true
	}
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	id := r.PathValue("id")
	var sets []string
	args := []any{id}
	add := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, column+" = $"+strconv.Itoa(len(args)))
	}
	if name != nil {
		add("name", *name)
	}
	if isActive != nil {
		add("is_active", *isActive)
	}
	if awardsXP != nil {
		add("awards_xp", *awardsXP)
	}
	if xpPerEvent != nil {
		add("xp_per_event", *xpPerEvent)
	}
	secret := ""
	if rotate {
		if secret, err = domain.GenerateSecret(); err != nil {
			return err
		}
		add("signing_secret", secret)
		add("secret_hash", domain.HashSecret(secret))
		sets = append(sets, "secret_rotated_at = now()")
	}
	if len(sets) == 0 {
		return httpx.BadRequest("Tidak ada perubahan")
	}
	tag, err := h.db.Exec(r.Context(), `UPDATE crm.crm_integration_partners SET `+strings.Join(sets, ", ")+` WHERE id = $1::text::uuid`, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Partner tidak ditemukan")
	}
	message := "Partner diperbarui"
	if secret != "" {
		message = "Secret baru dibuat"
	}
	return kit.OK(w, struct {
		ID     string `json:"id"`
		Secret string `json:"secret,omitempty"`
	}{id, secret}, message)
}

var (
	looseUUID     = regexp.MustCompile(`^(?i)[0-9a-f-]{36}$`)
	eventStatuses = []string{"pending", "processed", "unmatched", "failed", "ignored"}
)

// listEvents is the 200 newest partner events; unknown filter values are
// ignored. A loose-UUID partner_id reaches PostgreSQL as text, as
// node-postgres sends it, so a malformed one is a 400.
func (h *handler) listEvents(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GatePartners); err != nil {
		return err
	}
	var partnerID, status *string
	if v := r.URL.Query().Get("partner_id"); looseUUID.MatchString(v) {
		partnerID = &v
	}
	if v := r.URL.Query().Get("status"); slices.Contains(eventStatuses, v) {
		status = &v
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT e.id, e.external_event_id, e.event_type, e.customer_identifier, e.processing_status AS status,
            e.xp_awarded, e.error_message, e.received_at, e.occurred_at, e.processed_at, e.payload,
            p.name AS partner_name, p.code AS partner_code,
            c.id AS customer_id, c.name AS member_name, c.phone AS member_phone
       FROM crm.crm_external_events e
       JOIN crm.crm_integration_partners p ON p.id = e.partner_id
       LEFT JOIN pos.pos_customers c ON c.id = e.customer_id
      WHERE ($1::text::uuid IS NULL OR e.partner_id = $1::text::uuid)
        AND ($2::text IS NULL OR e.processing_status = $2)
      ORDER BY e.received_at DESC
      LIMIT 200`, partnerID, status)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}
