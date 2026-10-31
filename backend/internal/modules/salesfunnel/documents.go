package salesfunnel

import (
	"net/http"

	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// GET deals/{id} and quotations/{id}: the quotation document page opens
// from a link, so it reads the deal header and the quotation by id instead
// of from the pipeline board cache.

func (h *handler) dealDetail(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := h.require(ctx, "deal", id, u); err != nil {
		return err
	}
	row, err := pgrow.QueryOne(ctx, h.db, `SELECT `+dealColumns+`,
            l.pic_title, l.pic_email, c.name AS company_name, b.name AS branch_name
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
     LEFT JOIN configuration.companies c ON c.id = d.company_id
     LEFT JOIN configuration.branches b ON b.id = d.branch_id
     WHERE d.id = $1 AND d.deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound(notFoundMessages["deal"])
	}
	return ok(w, row)
}

func (h *handler) quotationDetail(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, _, err := h.requireQuotation(ctx, id, u); err != nil {
		return err
	}
	row, err := pgrow.QueryOne(ctx, h.db, `SELECT `+quotationColumns+`
     FROM crm.crm_sales_quotations q
     WHERE q.id = $1 AND q.deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	return ok(w, row)
}
