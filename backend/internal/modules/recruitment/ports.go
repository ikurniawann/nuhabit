package recruitment

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Ports reach other contexts. Employees and Contracts serve a candidate
// promotion; both results appear in the promotion response, so they run
// synchronously on the caller's Querier (not through the outbox).
// internal/app wires them.
type Ports struct {
	Employees Employees
	Contracts ContractDrafts
	// Settings, Speech and Hired are reads for the file and AI routes.
	Settings Settings
	Speech   Speech
	Hired    HiredEmployees
}

// Settings reads configuration.app_settings (AI keys and models).
type Settings interface {
	GetMany(ctx context.Context, q database.Querier, keys []string) (map[string]*string, error)
}

// Speech is synthesizeSpeechOrNull: the question as mp3 in the voice set in
// Settings → Suara AI, nil when synthesis failed (the adapter logs why).
type Speech interface {
	Synthesize(ctx context.Context, q database.Querier, text string) []byte
}

// HiredEmployees reads the employee a candidate was promoted to, for the
// pipeline report's "Hired" section (hris.employees and its onboarding).
type HiredEmployees interface {
	// Hired returns promotion_date, nip, join_date, employment_status,
	// is_active, has_account, department_name, job_title,
	// reporting_to_name, onboarding_total and onboarding_completed; nil
	// when the candidate was not promoted.
	Hired(ctx context.Context, q database.Querier, candidateID string) (*Row, error)
}

// Employees reads hris.employees.
type Employees interface {
	// Employee returns the employee row with its department {id, name,
	// code} and job_title {id, title} embeds, collected with CollectRow so
	// it renders like node-postgres. nil when the row cannot be read.
	Employee(ctx context.Context, q database.Querier, id string) (*Row, error)
}

// ContractDrafts creates HRIS employment contract drafts.
type ContractDrafts interface {
	// CreateDraft runs the contract compliance checks and inserts a draft
	// with the next contract number. A rule rejection comes back as a
	// non-empty rejection message with a nil error.
	CreateDraft(ctx context.Context, q database.Querier, in DraftContract) (number, rejection string, err error)
}

// DraftContract is createDraftContract's input for a promotion draft.
type DraftContract struct {
	EmployeeID       string
	ContractType     string
	StartDate        string
	EndDate          *string
	ProbationEndDate *string
	PositionTitle    *string
	BaseSalary       *string
	Notes            string
	CreatedByName    string
}

// CollectRow reads the first row of a query as a Row (nil when empty), for
// adapters that serve Employees.
func CollectRow(rows pgx.Rows, err error) (*Row, error) { return collectOne(rows, err) }
