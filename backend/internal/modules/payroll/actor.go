package payroll

import (
	"net/http"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// actor is WorkforceActor (lib/hris/workforce-auth.ts): the signed-in
// account, its role and its linked employee record. approved_by and
// reviewer columns reference hris.employees, so writes use EmployeeID,
// never UserID.
type actor struct {
	UserID     string
	Role       string
	EmployeeID *string
	IsHR       bool
}

// requireActor is requireWorkforceActor: any session (a profile row is not
// required; without one the role is ""), else 401 "Unauthorized".
func (h *handler) requireActor(r *http.Request) (*actor, error) {
	su, err := h.auth.Session(r)
	if err != nil {
		return nil, err
	}
	if su == nil {
		return nil, httpx.Unauthorized("Unauthorized")
	}
	a := &actor{UserID: su.ID}
	if u, err := h.auth.CurrentUser(r); err == nil && u != nil {
		a.Role = u.Role
	}
	id, err := h.svc.ports.Employees.IDByUser(r.Context(), h.svc.db, su.ID)
	if err != nil {
		return nil, err
	}
	if id != "" {
		a.EmployeeID = &id
	}
	a.IsHR = domain.IsHR(a.Role)
	return a, nil
}
