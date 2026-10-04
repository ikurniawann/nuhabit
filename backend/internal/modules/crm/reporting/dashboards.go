package reporting

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reporting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// sameCompany: one default (Overview) dashboard per company; NULL company
// is the global slot.
const sameCompany = `COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`

func (h *handler) listDashboards(w http.ResponseWriter, r *http.Request) error {
	_, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return err
	}
	params := []any{}
	where := "d.deleted_at IS NULL"
	if s.CompanyID != nil {
		params = append(params, *s.CompanyID)
		where += fmt.Sprintf(" AND (d.company_id IS NULL OR d.company_id = $%d)", len(params))
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT d.id, d.company_id, d.name, d.description, d.is_default, d.created_by, d.created_at, d.updated_at,
            u.full_name AS creator_name,
            (SELECT COUNT(*) FROM crm.crm_dashboard_widgets w WHERE w.dashboard_id = d.id) AS widget_count
     FROM crm.crm_dashboards d
     LEFT JOIN configuration.users u ON u.id = d.created_by
     WHERE `+where+`
     ORDER BY d.is_default DESC, d.name`, params...)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

func (h *handler) createDashboard(w http.ResponseWriter, r *http.Request) error {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseCreateDashboard(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	companyID := kit.ScopedCompanyID(u, s)
	makeDefault := *in.IsDefault && canManageShared(u)
	var row *kit.Row
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		if makeDefault {
			if _, err := tx.Exec(r.Context(), `UPDATE crm.crm_dashboards SET is_default = false, updated_at = now()
       WHERE is_default AND deleted_at IS NULL AND `+sameCompany, companyID); err != nil {
				return err
			}
		}
		var err error
		row, err = kit.QueryOne(r.Context(), tx, `INSERT INTO crm.crm_dashboards (company_id, name, description, is_default, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, is_default`, companyID, *in.Name, in.Description.Val, makeDefault, u.ID)
		return err
	})
	if err != nil {
		return err
	}
	return kit.Created(w, row, "Dashboard dibuat")
}

// requireDashboard mirrors requireDashboard: the dashboard in the user's
// company scope, 404 otherwise.
func (h *handler) requireDashboard(r *http.Request) (*auth.User, *kit.Scope, *kit.Row, error) {
	u, s, err := h.guard.RequireScope(r, kit.GateReports)
	if err != nil {
		return nil, nil, nil, err
	}
	params := []any{r.PathValue("id")}
	where := "id = $1::text::uuid AND deleted_at IS NULL"
	if s.CompanyID != nil {
		params = append(params, *s.CompanyID)
		where += fmt.Sprintf(" AND (company_id IS NULL OR company_id = $%d)", len(params))
	}
	row, err := kit.QueryOne(r.Context(), h.db, `SELECT id, company_id, name, description, is_default, created_by FROM crm.crm_dashboards WHERE `+where, params...)
	if err == nil && row == nil {
		err = httpx.NotFound("Dashboard tidak ditemukan")
	}
	return u, s, row, err
}

type widget struct {
	ID         string             `json:"id"`
	ReportID   string             `json:"report_id"`
	Title      string             `json:"title"`
	WidgetType string             `json:"widget_type"`
	Width      any                `json:"width"`
	SortOrder  any                `json:"sort_order"`
	ReportName string             `json:"report_name"`
	Dataset    string             `json:"dataset"`
	Definition *domain.Definition `json:"definition"`
	Result     *reportResult      `json:"result"`
}

// loadWidgets mirrors loadDashboardWidgets: each widget with its report's
// result; a report the user may not see, or one that fails, stays empty.
func (h *handler) loadWidgets(ctx context.Context, id string, u *auth.User, s *kit.Scope) ([]widget, error) {
	rows, err := kit.Query(ctx, h.db, `SELECT w.id, w.report_id, w.title, w.widget_type, w.width, w.sort_order,
            r.name AS report_name, r.dataset, r.definition
     FROM crm.crm_dashboard_widgets w
     JOIN crm.crm_reports r ON r.id = w.report_id AND r.deleted_at IS NULL
     WHERE w.dashboard_id = $1::text::uuid
     ORDER BY w.sort_order, w.id`, id)
	if err != nil {
		return nil, err
	}
	out := make([]widget, len(rows))
	for i, row := range rows {
		w := widget{
			ID: row.Str("id"), ReportID: row.Str("report_id"), Title: row.Str("report_name"), WidgetType: row.Str("widget_type"),
			Width: row.Get("width"), SortOrder: row.Get("sort_order"), ReportName: row.Str("report_name"), Dataset: row.Str("dataset"),
		}
		if t := row.StrPtr("title"); t != nil {
			w.Title = *t
		}
		allowed, err := h.loadAccessibleReport(ctx, w.ReportID, u, s)
		if err != nil {
			return nil, err
		}
		if allowed != nil {
			def, err := storedDefinition(row)
			if err != nil {
				return nil, err
			}
			// A savepoint keeps a failing report from aborting a surrounding transaction.
			var result *reportResult
			if database.WithTx(ctx, h.db, func(tx pgx.Tx) (err error) {
				result, err = h.runDefinition(ctx, tx, def, u, s)
				return err
			}) == nil {
				w.Definition, w.Result = &def, result
			}
		}
		out[i] = w
	}
	return out, nil
}

func (h *handler) getDashboard(w http.ResponseWriter, r *http.Request) error {
	u, s, dashboard, err := h.requireDashboard(r)
	if err != nil {
		return err
	}
	widgets, err := h.loadWidgets(r.Context(), r.PathValue("id"), u, s)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Dashboard *kit.Row `json:"dashboard"`
		Widgets   []widget `json:"widgets"`
	}{dashboard, widgets})
}

func (h *handler) patchDashboard(w http.ResponseWriter, r *http.Request) error {
	u, s, dashboard, err := h.requireDashboard(r)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parsePatchDashboard(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	if in.IsDefault != nil && !canManageShared(u) {
		return httpx.Forbidden("Hanya admin yang bisa menetapkan dashboard Overview")
	}
	for _, wd := range in.Widgets {
		report, err := h.loadAccessibleReport(r.Context(), wd.ReportID, u, s)
		if err != nil {
			return err
		}
		if report == nil {
			return httpx.BadRequest("Ada report yang tidak bisa diakses")
		}
	}
	id := dashboard.Str("id")
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		ctx := r.Context()
		var l setList
		if in.Name != nil {
			l.push("name", *in.Name, "")
		}
		if in.Description.Set {
			l.push("description", in.Description.Val, "")
		}
		if in.IsDefault != nil && *in.IsDefault {
			if _, err := tx.Exec(ctx, `UPDATE crm.crm_dashboards SET is_default = false, updated_at = now()
         WHERE is_default AND deleted_at IS NULL AND id <> $2 AND `+sameCompany, dashboard.StrPtr("company_id"), id); err != nil {
				return err
			}
		}
		if in.IsDefault != nil {
			l.push("is_default", *in.IsDefault, "")
		}
		if len(l.values) > 0 {
			if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE crm.crm_dashboards SET %s WHERE id = $%d`, l.sql(), len(l.values)+1), append(l.values, id)...); err != nil {
				return err
			}
		}
		if in.Widgets == nil {
			return nil
		}
		if _, err := tx.Exec(ctx, `DELETE FROM crm.crm_dashboard_widgets WHERE dashboard_id = $1`, id); err != nil {
			return err
		}
		for order, wd := range in.Widgets {
			if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_dashboard_widgets (dashboard_id, report_id, title, widget_type, width, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`, id, wd.ReportID, wd.Title, wd.WidgetType, wd.Width, order); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		ID string `json:"id"`
	}{r.PathValue("id")}, "Dashboard diperbarui")
}

func (h *handler) deleteDashboard(w http.ResponseWriter, r *http.Request) error {
	u, _, dashboard, err := h.requireDashboard(r)
	if err != nil {
		return err
	}
	if dashboard.Str("created_by") != u.ID && !canManageShared(u) {
		return httpx.Forbidden("Hanya pembuat atau admin yang bisa menghapus dashboard ini")
	}
	if _, err := h.db.Exec(r.Context(), `UPDATE crm.crm_dashboards SET deleted_at = now(), is_default = false WHERE id = $1`, dashboard.Str("id")); err != nil {
		return err
	}
	return kit.NoContent(w)
}
