package ticketing

import (
	"context"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// PublicPorts are what the public booking flow (/api/public/booking/**)
// needs from other contexts; internal/app/adapters_ticketing_public.go
// provides them.
type PublicPorts struct {
	Payments Payments
	Promo    Promo
	Branches Branches
}

// InvoiceRequest is CreateInvoiceInput (lib/xendit/client).
type InvoiceRequest struct {
	ExternalID  string
	Amount      float64
	PayerName   string
	Description string
	RedirectURL string
}

// Invoice is CreatedInvoice.
type Invoice struct {
	ID        string
	URL       string
	ExpiresAt time.Time
}

// Payments is the Xendit invoice client.
type Payments interface {
	// Configured is isXenditConfigured (secret key set, or mock mode).
	Configured() bool
	CreateInvoice(ctx context.Context, in InvoiceRequest) (Invoice, error)
	// ValidWebhookToken is isValidWebhookToken (constant time).
	ValidWebhookToken(token string) bool
}

// invoiceExpiryHours is getInvoiceExpiryHours().
const invoiceExpiryHours = 2

// PromoPreview is previewPromoCode's result: OK with the discount, or the
// rejection Reason and Message.
type PromoPreview struct {
	OK           bool
	Discount     float64
	CampaignName string
	DiscountType string
	Reason       string
	Message      string
}

// PromoCheck is a code checked against a venue and channel.
type PromoCheck struct {
	CompanyID, BranchID, Code, Channel string
	Subtotal                           float64
	Phone                              *string
}

// Promo is the promo-code service of the stored-value context
// (lib/promo/promo-server.ts).
type Promo interface {
	// Preview validates a code without claiming it.
	Preview(ctx context.Context, q database.Querier, in PromoCheck) (PromoPreview, error)
	// Hold claims the code for a booking inside the caller's transaction and
	// returns the discount. A rejection is an *httpx.Error (422) with the
	// promo message.
	Hold(ctx context.Context, q database.Querier, in PromoCheck, contextType, contextID string) (float64, error)
	// Capture makes the context's held redemption final (idempotent).
	Capture(ctx context.Context, q database.Querier, contextType, contextID string) error
}

// Branches reads venue names (configuration.branches).
type Branches interface {
	// Name is the branch name, nil when the branch is missing.
	Name(ctx context.Context, q database.Querier, branchID string) (*string, error)
}
