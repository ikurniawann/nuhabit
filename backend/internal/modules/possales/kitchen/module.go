// Package kitchen ports frontend/src/app/api/pos/kds (the kitchen display)
// and frontend/src/app/api/pos/print-jobs (the kitchen print queue polled by
// the print worker). Pure rules live in kitchen/domain.
package kitchen

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// TableRef is the slice of a pos.pos_tables row the kitchen display labels
// tickets with.
type TableRef struct {
	TableNumber string
	QRCode      string
}

// TableLookup reads POS tables, owned by pos-ops. Tables returns the tables
// with the given ids keyed by their id (lowercase uuid text).
type TableLookup interface {
	Tables(ctx context.Context, ids []string) (map[string]TableRef, error)
}

// Ports are the cross-context reads of this package.
type Ports struct {
	Tables TableLookup // nil = TablesSQL on deps.DB
}

// Handler serves the routes of this package.
type Handler struct {
	db     database.Querier
	auth   *auth.Service
	log    *slog.Logger
	now    func() time.Time
	tables TableLookup
}

// New builds the handler with the default adapters.
func New(deps module.Deps) *Handler { return NewWithPorts(deps, Ports{}) }

// NewWithPorts builds the handler with the given ports.
func NewWithPorts(deps module.Deps, p Ports) *Handler {
	h := &Handler{db: deps.DB, auth: deps.Auth, log: deps.Log, now: deps.Now, tables: p.Tables}
	if h.tables == nil {
		h.tables = TablesSQL{DB: deps.DB}
	}
	if h.now == nil {
		h.now = time.Now
	}
	if h.log == nil {
		h.log = slog.Default()
	}
	return h
}

// Routes lists the kitchen display and print queue routes.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/kds", Handler: httpx.Handle(h.listKDS)},
		{Pattern: "GET /api/pos/print-jobs", Handler: h.printQueue(h.listPrintJobs)},
		{Pattern: "POST /api/pos/print-jobs", Handler: h.printQueue(h.createPrintJob)},
		{Pattern: "PATCH /api/pos/print-jobs/{id}", Handler: h.printQueue(h.updatePrintJob)},
	}
}

// printQueue guards a print-queue route like authorizePrintQueueRequest: a
// POS session, or the print worker's X-POS-Print-Worker-Token header equal
// (constant time, both trimmed) to the POS_PRINT_WORKER_TOKEN env var.
func (h *Handler) printQueue(fn httpx.HandlerFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		_, err := kit.PosUser(h.auth, r)
		if err != nil {
			var he *httpx.Error
			if !errors.As(err, &he) || he.Status != http.StatusUnauthorized {
				return err
			}
			if !workerTokenMatches(r) {
				return kit.Fail(w, http.StatusUnauthorized, "Authentication required")
			}
		}
		return fn(w, r)
	})
}

func workerTokenMatches(r *http.Request) bool {
	expected := strings.TrimSpace(os.Getenv("POS_PRINT_WORKER_TOKEN"))
	given := strings.TrimSpace(r.Header.Get("X-POS-Print-Worker-Token"))
	if expected == "" || given == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(given)) == 1
}
