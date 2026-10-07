package inbox

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Quick-reply templates: every inbox agent reads them, the CRM settings
// menu manages them.

func (h *handler) listTemplates(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateInbox); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT id, title, body, is_active FROM crm.wa_reply_templates
      WHERE is_active ORDER BY title`)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// saveTemplate creates a template, or updates it when id is sent (404 when
// it does not exist).
func (h *handler) saveTemplate(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	id := f.UUID("id", validate.Rule{Optional: true})
	title := f.Str("title", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 80})
	body := f.Str("body", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 2000})
	active := f.BoolDefault("is_active", true)
	if !f.Valid() {
		return httpx.BadRequest("Payload tidak valid")
	}
	ctx := r.Context()
	if id != nil {
		row, err := kit.QueryOne(ctx, h.db, `UPDATE crm.wa_reply_templates
          SET title = $2, body = $3, is_active = $4
        WHERE id = $1 RETURNING id, title, body, is_active`, *id, *title, *body, active)
		if err != nil {
			return err
		}
		if row == nil {
			return httpx.NotFound("Template tidak ditemukan")
		}
		return kit.OK(w, row)
	}
	row, err := kit.QueryOne(ctx, h.db, `INSERT INTO crm.wa_reply_templates (title, body, is_active)
     VALUES ($1, $2, $3) RETURNING id, title, body, is_active`, *title, *body, active)
	if err != nil {
		return err
	}
	return kit.OK(w, row)
}

func (h *handler) deleteTemplate(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		return httpx.BadRequest("Template id wajib diisi")
	}
	if _, err := h.db.Exec(r.Context(), `DELETE FROM crm.wa_reply_templates WHERE id = $1::text::uuid`, id); err != nil {
		return err
	}
	return kit.Success(w)
}
