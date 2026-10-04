package recruitment

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Ports reach the HRIS people context during a candidate promotion. Both
// results appear in the promotion response, so they run synchronously on
// the caller's Querier (not through the outbox). internal/app wires them.
type Ports struct {
	Employees Employees
	Contracts ContractDrafts
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
