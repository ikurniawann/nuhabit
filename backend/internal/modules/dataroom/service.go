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
	// ActorDepartment is the department of the user's latest employee row;
	// nil without one.
	ActorDepartment(ctx context.Context, userID string) (id, name *string, err error)
	// Departments lists the active departments by name.
	Departments(ctx context.Context) ([]DepartmentRef, error)
	// DepartmentsByID returns the departments that exist among ids, by name.
	DepartmentsByID(ctx context.Context, ids []string) ([]DepartmentRef, error)
}

// Person is a staff account for grants and mentions.
type Person struct {
	ID       string  `json:"id"`
	FullName string  `json:"full_name"`
	Email    *string `json:"email"`
	Role     string  `json:"role"`
}

// People reads active staff accounts (configuration.users).
type People interface {
	// Search lists active accounts whose name or email contains q (all
	// when empty), by name, at most limit.
	Search(ctx context.Context, q string, limit int) ([]Person, error)
	// ByIDs returns the accounts that exist among ids.
	ByIDs(ctx context.Context, ids []string) ([]Person, error)
}

// Mailer sends one HTML email; false when it was not sent.
type Mailer interface {
	Send(ctx context.Context, to, from, subject, html string) bool
}

// Ports are the module's outside dependencies, wired in internal/app.
type Ports struct {
	Directory Directory
	People    People
	Mailer    Mailer
	// AppOrigin prefixes share links and dashboard links in emails.
	AppOrigin string
	// Brand is brandName(); MailFrom is DATAROOM_FROM_EMAIL ?? FROM_EMAIL,
	// empty for the sender configured in Settings → Integrasi → Email.
	Brand, MailFrom string
	// QuotaBytes and MaxFileBytes are DATAROOM_QUOTA_BYTES and
	// DATAROOM_MAX_FILE_BYTES (one multipart upload). MaxChunkedBytes caps
	// a chunked upload session (DATAROOM_MAX_CHUNKED_MB, default 2 GB).
	QuotaBytes, MaxFileBytes, MaxChunkedBytes float64
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
	if ports.MaxChunkedBytes == 0 {
		ports.MaxChunkedBytes = 2048 * 1024 * 1024
	}
	if ports.People == nil {
		ports.People = noPeople{}
	}
	return &Service{db: db, ports: ports, now: now, log: log, production: production, store: storage.FromEnv()}
}

// noPeople is the People port of a fixture without one.
type noPeople struct{}

func (noPeople) Search(context.Context, string, int) ([]Person, error) { return []Person{}, nil }
func (noPeople) ByIDs(context.Context, []string) ([]Person, error)     { return []Person{}, nil }

// missingConfigTable is the fallback for an instance without
// dataroom.folder_departments: it keeps working without department limits.
func (s *Service) missingConfigTable(err error) bool {
	if !database.IsUndefinedTable(err) {
		return false
	}
	s.warnOnce.Do(func() {
		s.log.Warn("[dataroom] tabel dataroom.folder_departments belum ada. Jalankan migration " +
			"20260905110000_dataroom_folder_departments.sql. Akses per departemen nonaktif sementara.")
	})
	return true
}
