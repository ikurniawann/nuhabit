package dataroom

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/storage"
)

// DepartmentRef is a department id and name.
type DepartmentRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Directory reads HRIS departments and employees (owned by the hris
// module) for department access.
type Directory interface {
	// ActorDepartment is the department of the user's latest employee row
	// (resolveActor); nil without one.
	ActorDepartment(ctx context.Context, userID string) (id, name *string, err error)
	// Departments lists the active departments by name (listDepartments).
	Departments(ctx context.Context) ([]DepartmentRef, error)
	// DepartmentsByID returns the departments that exist among ids, by name.
	DepartmentsByID(ctx context.Context, ids []string) ([]DepartmentRef, error)
}

// Mailer sends one HTML email (lib/resend sendEmail); false when it was
// not sent.
type Mailer interface {
	Send(ctx context.Context, to, from, subject, html string) bool
}

// Ports are the module's outside dependencies, wired in internal/app.
type Ports struct {
	Directory Directory
	Mailer    Mailer
	// AppOrigin prefixes share links (appOrigin() without a request).
	AppOrigin string
	// Brand is brandName(); MailFrom is DATAROOM_FROM_EMAIL ?? FROM_EMAIL ??
	// the Resend onboarding sender.
	Brand, MailFrom string
	// QuotaBytes and MaxFileBytes are DATAROOM_QUOTA_BYTES and
	// DATAROOM_MAX_FILE_BYTES.
	QuotaBytes, MaxFileBytes float64
}

// Service holds the Dataroom use cases.
type Service struct {
	db         database.DB
	ports      Ports
	now        func() time.Time
	log        *slog.Logger
	production bool
	warnOnce   sync.Once
	// store holds the uploaded files (STORAGE_DIR, shared with Next).
	store *storage.Store
}

// NewService builds the service on db (a pool, or a tx in tests).
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger, production bool) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, ports: ports, now: now, log: log, production: production, store: storage.FromEnv()}
}

// missingConfigTable is selectConfigs' fallback: an instance without
// dataroom.folder_departments keeps working without department limits.
func (s *Service) missingConfigTable(err error) bool {
	if !database.IsUndefinedTable(err) {
		return false
	}
	s.warnOnce.Do(func() {
		s.log.Warn("[dataroom] tabel dataroom.folder_departments belum ada — jalankan migration " +
			"20260905110000_dataroom_folder_departments.sql. Akses per departemen nonaktif sementara.")
	})
	return true
}
