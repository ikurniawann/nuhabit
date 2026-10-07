package memberportal

import (
	"context"

	"nuhabit/backend/internal/modules/memberportal/domain"
)

// Ports to capabilities owned by other bounded contexts. The adapters live
// in this package for now (adapters_*.go) and move to their owning modules
// (wallet, payments, notifications, crm loyalty) when those exist.

// Notifier delivers WhatsApp messages (lib/whatsapp). It never fails the
// caller: a delivery problem comes back as Delivered=false with a reason.
type Notifier interface {
	SendOTP(ctx context.Context, target, code, fallbackText string) Delivery
	SendText(ctx context.Context, target, message, messageType string) Delivery
}

// Delivery is the outcome of one WhatsApp send.
type Delivery struct {
	Delivered bool
	Reason    string
	Provider  string
	MessageID string
	TimedOut  bool
}

// Pusher delivers web push notifications to a member's devices
// (lib/member-portal/push). Best effort; never fails the caller.
type Pusher interface {
	PublicKey() string
	PushMember(ctx context.Context, customerID string, msg PushMessage)
}

// PushMessage is one web push.
type PushMessage struct {
	Title string
	Body  string
	Link  string
	Type  string
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

// Payments is the Xendit QRIS gateway (lib/payments/xendit).
type Payments interface {
	LoadConfig(ctx context.Context) (*XenditConfig, error)
	CreateDynamicQR(ctx context.Context, secretKey, referenceID string, amount float64, callbackURL, description string) (*XenditQR, error)
	QRPayments(ctx context.Context, secretKey, qrID string) ([]map[string]any, error)
	QRCode(ctx context.Context, secretKey, qrID string) (map[string]any, error)
}

// WalletRow is one pos.pos_wallet_transactions row.
type WalletRow struct {
	ID                  string
	CustomerID          string
	Type                string
	Status              string
	Amount              float64
	BalanceBefore       float64
	BalanceAfter        float64
	XenditTransactionID *string
	Notes               *string
	Metadata            map[string]any
	CreatedAt           jsTime
	CompanyID           *string
	BranchID            *string
}

// TopupPackage is a pos.pos_topup_packages row.
type TopupPackage struct {
	ID           string
	Name         string
	Description  string
	PriceIdr     float64
	CreditIdr    float64
	ValidityDays *float64
}

// WalletSettings are the wallet columns of pos_loyalty_settings.
type WalletSettings struct {
	ArkRate        float64
	TopupMinAmount float64
	TopupMaxAmount float64
}

// NewPendingTopup is the pending QRIS row to insert.
type NewPendingTopup struct {
	CustomerID          string
	Amount              float64
	BalanceBefore       float64
	ArkRate             float64
	ReferenceID         string
	Notes               string
	Metadata            map[string]any
	XenditTransactionID *string
	PackageID           *string
	CompanyID           *string
	BranchID            *string
}

// CreditOutcome is the result of crediting a pending top-up.
type CreditOutcome struct {
	Status     string // completed | already_completed | ignored | not_found
	CustomerID string
	Amount     float64
}

// ReconcileRow is the part of a top-up the Xendit reconciliation reads.
type ReconcileRow struct {
	Status              string
	PaymentMethod       string
	XenditTransactionID string
}

// WalletLedger is the ARK Coin wallet (lib/wallet). Balance changes run in
// one transaction with the member row locked.
type WalletLedger interface {
	Settings(ctx context.Context) (WalletSettings, error)
	LoyaltySettings(ctx context.Context) (domain.LoyaltySettings, error)
	ArkCoinEnabled(ctx context.Context) bool
	MemberPackages(ctx context.Context) ([]TopupPackage, error)
	// PackageForMember is nil when the package is not sold online.
	PackageForMember(ctx context.Context, id string) (*TopupPackage, error)
	Balance(ctx context.Context, customerID string) (balance float64, found bool, err error)
	LatestOpenMemberTopup(ctx context.Context, customerID string) (*string, error)
	CountRecentMemberTopups(ctx context.Context, customerID string) (int, error)
	InsertPendingTopup(ctx context.Context, row NewPendingTopup) (*WalletRow, error)
	MemberTopup(ctx context.Context, customerID, id string) (*WalletRow, error)
	TopupForReconcile(ctx context.Context, id string) (*ReconcileRow, error)
	CreditPendingTopup(ctx context.Context, id, xenditPaymentID, notes string) (CreditOutcome, error)
	CreditBonus(ctx context.Context, customerID string, amountIdr float64, notes string) (float64, error)
}

// XPAward is one flat XP award request (lib/crm/loyalty-awards).
type XPAward struct {
	CustomerID     string
	XPAmount       float64
	CompanyID      *string
	BranchID       *string
	SourceType     string
	SourceID       string
	ReferenceTable string
	IdempotencyKey string
	Description    string
}

// XPResult mirrors CrmXpAwardResult.
type XPResult struct {
	Status    string // posted | duplicate | skipped | error
	XPAwarded float64
}

// Loyalty posts XP to the CRM ledger and keeps pos_customers and the tier in
// sync (lib/crm/loyalty-*).
type Loyalty interface {
	AwardFlatXP(ctx context.Context, award XPAward) (XPResult, error)
	AwardTopupXP(ctx context.Context, customerID string, amountIdr float64, transactionID string) (XPResult, error)
}
