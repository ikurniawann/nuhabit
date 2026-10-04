package posops

import (
	"net/http"

	"nuhabit/backend/internal/platform/module"
)

// Table routes (app/api/pos/tables). Their catch answers 500 with
// error.message for real Errors and a fixed text for QueryBuilder errors.
func (h *Handler) tableRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/tables", Handler: caught(fixed("Failed to load POS tables"), h.tableBoard)},
		{Pattern: "POST /api/pos/tables", Handler: caught(fixed("Failed to create table"), h.createTable)},
		{Pattern: "PATCH /api/pos/tables/{id}", Handler: caught(fixed("Failed to update table"), h.updateTable)},
		{Pattern: "DELETE /api/pos/tables/{id}", Handler: caught(fixed("Failed to delete table"), h.deleteTable)},
		{Pattern: "PATCH /api/pos/tables/{id}/position", Handler: caught(fixed("Failed to save position"), h.moveTable)},
	}
}

func (h *Handler) tableBoard(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	board, err := h.svc.TableBoard(r.Context(), user.ID, r.URL.Query().Get("include_inactive") == "true")
	if err != nil {
		return err
	}
	return okData(w, board)
}

func (h *Handler) createTable(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	body, err := objectBody(r, "table_number")
	if err != nil {
		return err
	}
	table, err := h.svc.CreateTable(r.Context(), body)
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "message", "Table created", "data", table))
}

func (h *Handler) updateTable(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	body, err := objectBody(r, "table_number")
	if err != nil {
		return err
	}
	table, err := h.svc.UpdateTable(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "message", "Table updated", "data", table))
}

func (h *Handler) deleteTable(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	if err := h.svc.DeactivateTable(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "message", "Table deactivated"))
}

func (h *Handler) moveTable(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	body, err := jsonBody(r)
	if err != nil {
		return err
	}
	pos, err := h.svc.MoveTable(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusOK, NewObj("success", true, "message", "Table position saved", "data", pos))
}
