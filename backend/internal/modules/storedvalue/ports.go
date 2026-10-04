package storedvalue

import (
	"context"

	"nuhabit/backend/internal/modules/storedvalue/giftcards"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	"nuhabit/backend/internal/platform/database"
)

// Ports are the capabilities this module reaches in other bounded contexts.
// internal/app wires the adapters (internal/app/adapters_storedvalue*.go).
type Ports struct {
	Directory   Directory
	Loyalty     Loyalty
	Supervisors Supervisors
	WhatsApp    WhatsApp
	Gateway     QRISGateway
	Orders      MemberBillOrders
	GiftCards   giftcards.Ports
	Promo       promo.Ports
}

// Shared types live in kit so the gift card and promo sub-packages use
// the same ones.
type (
	Venue     = kit.Venue
	Branch    = kit.Branch
	Directory = kit.Directory
)

// CrmXP is CrmXpAwardResult, serialized exactly as the TS object.
type CrmXP struct {
	Status    string   `json:"status"`
	XPAwarded float64  `json:"xpAwarded"`
	Reason    string   `json:"reason,omitempty"`
	LedgerIDs []string `json:"ledgerIds,omitempty"`
}

// Loyalty posts CRM XP (lib/crm/loyalty-engine). Failures never fail the
// caller: they come back as status "error" or "skipped".
type Loyalty interface {
	AwardTopupXP(ctx context.Context, db database.DB, customerID string, amountIdr float64, transactionID string) CrmXP
}

// ApprovedSupervisor is the supervisor whose PIN approved an action.
type ApprovedSupervisor struct {
	ID   string
	Name string
}

// SupervisorApproval is SupervisorPinApproval: OK, or rejected because the
// PIN is wrong ("invalid") or the caller is locked out ("locked").
type SupervisorApproval struct {
	OK           bool
	Supervisor   ApprovedSupervisor
	Reason       string
	RetryMinutes int
}

// Supervisors verifies a supervisor PIN with the durable attempt limit
// (approveWithSupervisorPin in lib/pos/supervisor-pin-server.ts).
type Supervisors interface {
	Approve(ctx context.Context, callerID, pin string) (SupervisorApproval, error)
}

// WADelivery is the outcome of one WhatsApp send.
type WADelivery struct {
	Delivered bool
	Reason    string
}

// WhatsApp sends WhatsApp messages (lib/whatsapp sendWhatsAppText) and the
// owner's comp notification (lib/wa/comp-notification notifyFocTopup).
type WhatsApp interface {
	SendText(ctx context.Context, target, message, messageType string, sentByUserID *string) WADelivery
	// NotifyFocTopup is fire-and-forget; it never fails the caller.
	NotifyFocTopup(ctx context.Context, n FocTopupNotice)
}

// FocTopupNotice is notifyFocTopup's input.
type FocTopupNotice struct {
	TransactionID string
	AmountIdr     float64
	ApprovedName  *string
	CustomerID    string
}

// XenditConfig is the active QRIS gateway row.
type XenditConfig struct {
	SecretKey   string
	CallbackURL string
	Environment string
}

// XenditQR is a created dynamic QR.
type XenditQR struct {
	ID        string
	QRString  string
	Status    string
	ExpiresAt string
}

// QRISGateway is Xendit QRIS (lib/payments/xendit.ts).
type QRISGateway interface {
	LoadConfig(ctx context.Context, q database.Querier) (*XenditConfig, error)
	CreateDynamicQR(ctx context.Context, secretKey, referenceID string, amount float64, callbackURL, description string) (*XenditQR, error)
	QRPayments(ctx context.Context, secretKey, qrID string) ([]map[string]any, error)
	QRCode(ctx context.Context, secretKey, qrID string) (map[string]any, error)
}
