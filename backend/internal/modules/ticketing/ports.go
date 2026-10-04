package ticketing

import (
	"context"
	"errors"

	"nuhabit/backend/internal/platform/database"
)

// Ports to data and capabilities owned by other bounded contexts. The
// adapters live in internal/app/adapters_ticketing.go.
type Ports struct {
	Venues    Venues
	Employees Employees
	Messenger Messenger
	// AppOrigin prefixes the booking status links sent over WhatsApp
	// (appOrigin() without a request: NEXT_PUBLIC_APP_URL or "").
	AppOrigin string
}

// Venues resolves the caller's ticketing venue: the user's business scope
// (company always, branch only for branch-scoped users) completed by the
// CRM default_company_id / default_branch_id settings
// (resolveTicketingVenue). An empty id means unresolved.
type Venues interface {
	Resolve(ctx context.Context, userID string) (companyID, branchID string, err error)
}

// Employee is what ticketing reads about an HRIS employee holding a
// staff pass band.
type Employee struct {
	ID       string
	FullName string
	NIP      *string
	IsActive bool
	// Matched reports whether full_name or nip ILIKE the search pattern.
	Matched bool
}

// Employees reads hris.employees (owned by HRIS). Find returns the given
// employees ordered by full_name; pattern is an ILIKE pattern ("" matches
// nothing). It runs on the caller's Querier so gate taps and pairing read
// inside their transaction.
type Employees interface {
	Find(ctx context.Context, q database.Querier, ids []string, pattern string) ([]Employee, error)
}

// ErrMessengerNotConfigured is the "gateway-belum-dikonfigurasi" outcome.
var ErrMessengerNotConfigured = errors.New("gateway-belum-dikonfigurasi")

// Messenger sends a WhatsApp text through the self-hosted gateway
// (lib/whatsapp/gateway sendGatewayText). The resend route reports the
// outcome, so it is a synchronous port.
type Messenger interface {
	SendText(ctx context.Context, target, message string) error
}
