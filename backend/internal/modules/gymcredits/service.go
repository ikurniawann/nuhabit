// Package gymcredits is the gym class-credit bounded context (module name
// "gym-credits"): credit packages, purchases, the append-only credit ledger
// with FIFO lots, and the gym business rules. Port of
// frontend/src/lib/gym/{credits,credit-*,rules}*.ts.
package gymcredits

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Error is a credit rule failure that is safe to show (GymCreditError and
// the ApiErrors of the TS libs). Handlers render it with its status.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

func fail(status int, msg string) *Error { return &Error{Status: status, Message: msg} }

// DB is what the service runs on: the pool, or an open transaction (tests run
// every use case inside a rolled-back tx). Begin on a tx opens a savepoint.
type DB interface {
	database.Querier
	Begin(ctx context.Context) (pgx.Tx, error)
}

/* ── Ports to other bounded contexts ─────────────────────────────────── */

// MemberSummary is a customer row as the credit search lists it.
type MemberSummary struct {
	ID       string  `json:"id"`
	Name     *string `json:"name"`
	Phone    string  `json:"phone"`
	Email    *string `json:"email"`
	IsActive bool    `json:"is_active"`
}

// MemberProfile is the customer header of the staff credit page.
type MemberProfile struct {
	ID             string  `json:"id"`
	Name           *string `json:"name"`
	Phone          string  `json:"phone"`
	Email          *string `json:"email"`
	IsActive       bool    `json:"is_active"`
	MembershipTier *string `json:"membership_tier"`
	ArkBalanceIdr  float64 `json:"ark_balance_idr"`
}

// Members reads customers (pos.pos_customers, owned by POS/membership).
type Members interface {
	// Search matches name/phone/email (ILIKE), ordered by name, at most limit.
	Search(ctx context.Context, db database.Querier, term string, limit int) ([]MemberSummary, error)
	// ByIDs returns the customers that exist, in any order.
	ByIDs(ctx context.Context, db database.Querier, ids []string) ([]MemberSummary, error)
	Profile(ctx context.Context, db database.Querier, id string) (*MemberProfile, error)
	// LockForPurchase locks the customer row in the caller's transaction so
	// concurrent purchases serialize on the per-member limit.
	LockForPurchase(ctx context.Context, tx database.Querier, id string) (active, found bool, err error)
	// IsActive is false for an unknown customer.
	IsActive(ctx context.Context, db database.Querier, id string) (bool, error)
}

// ArkMove is one ARK Coin balance change (rupiah) caused by a credit purchase.
type ArkMove struct {
	CustomerID string
	Delta      float64
	Notes      string
	PurchaseID string
	BranchID   *string
	ActorID    *string
}

// Errors an ArkWallet returns for the rules it enforces.
var (
	ErrArkMemberNotFound = errors.New("ark wallet: member not found")
	ErrArkInsufficient   = errors.New("ark wallet: insufficient balance")
)

// ArkWallet is the ARK Coin wallet (pos.pos_wallet_transactions). Move runs
// in the caller's transaction so the debit and the credit grant commit together.
type ArkWallet interface {
	Move(ctx context.Context, tx database.Querier, m ArkMove) error
	Balance(ctx context.Context, db database.Querier, customerID string) (float64, error)
	Rate(ctx context.Context, db database.Querier) (float64, error)
	// Enabled is the CRM ark_coin_enabled flag (default on when unreadable).
	Enabled(ctx context.Context, db database.Querier) bool
}

// Directory reads org and catalog data owned elsewhere.
type Directory interface {
	ActiveBranches(ctx context.Context, db database.Querier) ([]Branch, error)
	BranchNames(ctx context.Context, db database.Querier, ids []string) (map[string]string, error)
	// PublicBranch resolves an active branch by its public slug, code or id;
	// nil when none matches.
	PublicBranch(ctx context.Context, db database.Querier, key string) (*PublicBranch, error)
	// ActiveClassTypes is empty while gym.class_types does not exist.
	ActiveClassTypes(ctx context.Context, db database.Querier) ([]ClassType, error)
	// BookingClassType is the class type of a booking's session; "" when
	// bookingID is no booking.
	BookingClassType(ctx context.Context, db database.Querier, bookingID string) (string, error)
	StaffNames(ctx context.Context, db database.Querier, ids []string) (map[string]*string, error)
}

// Branch is an active branch.
type Branch struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ClassType is an active class type offered as package coverage.
type ClassType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// XenditConfig is the active QRIS gateway configuration.
type XenditConfig struct {
	SecretKey   string
	CallbackURL string
	Environment string
}

// QRRequest creates a dynamic QRIS.
type QRRequest struct {
	SecretKey   string
	ReferenceID string
	Amount      float64
	CallbackURL string
	Description string
}

// QRCode is a created dynamic QRIS.
type QRCode struct {
	ID        string
	QRString  string
	ExpiresAt string // "" when the gateway sent none
}

// QRISGateway is the payment provider (Xendit QRIS).
type QRISGateway interface {
	// ActiveConfig fails with a user-facing message when no active gateway exists.
	ActiveConfig(ctx context.Context, db database.Querier) (*XenditConfig, error)
	CreateDynamicQR(ctx context.Context, req QRRequest) (*QRCode, error)
	// QRPayments lists the payments of a QR (GET /qr_codes/{id}/payments).
	QRPayments(ctx context.Context, secretKey, qrID string) ([]map[string]any, error)
}

// InvoiceRequest creates a hosted Xendit invoice (checkout page).
type InvoiceRequest struct {
	ExternalID  string
	Amount      float64
	PayerName   string
	Description string
	RedirectURL string
}

// Invoice is a created invoice; Mock is set in XENDIT_MOCK mode.
type Invoice struct {
	ID        string
	URL       string
	ExpiresAt time.Time
	Mock      bool
}

// InvoiceGateway is the Xendit invoice API (XENDIT_SECRET_KEY, XENDIT_MOCK).
type InvoiceGateway interface {
	// InvoiceConfigured reports whether invoices can be created.
	InvoiceConfigured() bool
	CreateInvoice(ctx context.Context, req InvoiceRequest) (*Invoice, error)
	// InvoiceStatus is the upper-cased Xendit invoice status (PENDING, PAID,
	// SETTLED, EXPIRED).
	InvoiceStatus(ctx context.Context, invoiceID string) (string, error)
}

// Notice is an in-app message to a member.
type Notice struct {
	Type  string
	Title string
	Body  string
}

// Notifier stores a member notification and asks CRM to deliver it, in the
// caller's transaction.
type Notifier interface {
	NotifyMember(ctx context.Context, q database.Querier, customerID string, n Notice) error
}

/* ── Service ─────────────────────────────────────────────────────────── */

// Ports bundles the adapters the service needs from other contexts.
type Ports struct {
	Members   Members
	Wallet    ArkWallet
	Directory Directory
	Gateway   QRISGateway
	Invoices  InvoiceGateway
	// Vouchers is the promo-code engine; nil turns voucher codes away.
	Vouchers Vouchers
	Notifier Notifier
	// SavedMethods charges saved cards and e-wallets; nil turns them off.
	SavedMethods SavedMethodGateway
}

// Service holds the credit use cases.
type Service struct {
	db    DB
	repo  Repository
	ports Ports
	now   func() time.Time
	log   *slog.Logger
	// CanSimulate is the local-dev guard of canSimulateTopup (dev QR + simulate-paid).
	canSimulate func() bool
	// alert counts a problem an operator must fix (a metric in production).
	alert func(reason string)
}

// NewService builds the service.
func NewService(db DB, repo Repository, ports Ports, now func() time.Time, log *slog.Logger, canSimulate func() bool) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	if canSimulate == nil {
		canSimulate = func() bool { return false }
	}
	return &Service{db: db, repo: repo, ports: ports, now: now, log: log, canSimulate: canSimulate, alert: func(string) {}}
}

// WithAlerts sets the counter of problems an operator must fix.
func (s *Service) WithAlerts(alert func(reason string)) *Service {
	if alert != nil {
		s.alert = alert
	}
	return s
}

// CanSimulate reports whether dev-only simulated payments are allowed.
func (s *Service) CanSimulate() bool { return s.canSimulate() }

// clock is the JS Date the TS compared against: millisecond precision.
func (s *Service) clock() time.Time { return s.now().Truncate(time.Millisecond) }

/* ── Repository (postgres.go) ────────────────────────────────────────── */

// NewEntry is a ledger row to insert. Empty strings are NULL.
type NewEntry struct {
	CustomerID      string
	Type            domain.EntryType
	Amount          int
	LotID           string
	SourceType      string
	SourceID        string
	ReversesEntryID string
	Note            string
	IdempotencyKey  string
	CreatedBy       string
}

// NewLot is a credit lot to insert. Empty strings are NULL.
type NewLot struct {
	CustomerID string
	PackageID  string
	PurchaseID string
	Credits    int
	ExpiresAt  time.Time
}

// StoredEntry is a ledger row with its owner, as the reversal reads it.
type StoredEntry struct {
	domain.Entry
	CustomerID string
}

// RecentEntry is a ledger row for the wallet history.
type RecentEntry struct {
	ID              string
	Type            string
	Amount          int
	LotID           *string
	SourceType      *string
	SourceID        *string
	ReversesEntryID *string
	Note            *string
	CreatedBy       *string
	Reversed        bool
	CreatedAt       time.Time
}

// PackageForPurchase is the package columns a purchase needs.
type PackageForPurchase struct {
	ID                     string
	Status                 string
	Kind                   string
	Credits                int
	PriceIdr               float64
	PurchaseLimitPerMember *int
	BranchID               *string
}

// NewPass is a member pass to insert when a pass purchase is paid.
type NewPass struct {
	CustomerID string
	PackageID  string
	PurchaseID string
	StartsAt   time.Time
	EndsAt     time.Time
	AutoRenew  bool
	RenewWith  string
}

// Pass event kinds (gym.member_pass_events.kind).
const (
	EventFreeze    = "freeze"
	EventUnfreeze  = "unfreeze"
	EventExtend    = "extend"
	EventAutoRenew = "auto_renew"
	EventRenewal   = "renewal"
)

// PassEvent is one row of the pass log. Empty strings and zero Days are NULL.
type PassEvent struct {
	PassID     string
	CustomerID string
	Kind       string
	Days       int
	Reason     string
	Meta       map[string]any
	ActorID    string
}

// NewPurchase is a pending purchase to insert.
type NewPurchase struct {
	CustomerID    string
	PackageID     string
	Credits       int
	PriceIdr      float64
	DiscountIdr   float64
	TotalIdr      float64
	Channel       string
	PaymentMethod string
	BranchID      *string
	Note          *string
	CreatedBy     *string
}

// PackageInput is the body of POST /api/gym/packages after validation.
type PackageInput struct {
	ID                     *string
	Name                   string
	Description            string
	Kind                   string
	Credits                int
	PriceIdr               float64
	ValidityDays           int
	PurchaseLimitPerMember *int
	ApplicableClassTypeIDs []string
	BranchID               *string
	IsPublic               bool
	Badge                  *string
	BranchPrices           []BranchPrice
	SortOrder              int
}

// LotValue is what the credits of a paid lot are worth in the journals:
// the purchase total over the lot's credits, booked to the purchase company.
type LotValue struct {
	TotalIdr  float64
	Credits   int
	CompanyID *string
}

// PassRevenue is a paid pass with revenue still to release.
type PassRevenue struct {
	PassID     string
	PurchaseID string
	CompanyID  *string
	TotalIdr   float64
	Released   float64
	StartsAt   time.Time
	EndsAt     time.Time
}

// PassRelease is pass revenue released on Day (YYYY-MM-DD) in the journal
// batch BatchID.
type PassRelease struct {
	PassID  string
	BatchID string
	Day     string
	Amount  float64
}

// RulesRow is one gym.business_rules row; Rules is the decoded jsonb.
type RulesRow struct {
	BranchID *string
	Rules    any
}

// Repository is the module's own tables (schema gym, credit tables and
// business_rules). Every method runs on the Querier it is given.
type Repository interface {
	LockMemberCredits(ctx context.Context, q database.Querier, customerID string) error
	Lots(ctx context.Context, q database.Querier, customerID string) ([]domain.Lot, error)
	Entries(ctx context.Context, q database.Querier, customerID string) ([]domain.Entry, error)
	// InsertEntry returns "" when the idempotency key already exists.
	InsertEntry(ctx context.Context, q database.Querier, e NewEntry) (string, error)
	EntryIDByKey(ctx context.Context, q database.Querier, key string) (string, error)
	InsertLot(ctx context.Context, q database.Querier, l NewLot) (string, error)
	Entry(ctx context.Context, q database.Querier, id string) (*StoredEntry, error)
	IsReversed(ctx context.Context, q database.Querier, entryID string) (bool, error)
	PackageCoverage(ctx context.Context, q database.Querier) (map[string][]string, error)
	PackageNames(ctx context.Context, q database.Querier) (map[string]string, error)
	RecentEntries(ctx context.Context, q database.Querier, customerID string, limit int) ([]RecentEntry, error)
	Balances(ctx context.Context, q database.Querier, customerIDs []string) (map[string]int, error)
	RecentlyActive(ctx context.Context, q database.Querier, limit int) ([]string, error)
	// LotValues returns the value of the paid lots among ids.
	LotValues(ctx context.Context, q database.Querier, ids []string) (map[string]LotValue, error)
	// MembersWithLapsedLots lists up to limit members, by id after after,
	// whose lapsed lots still hold credits.
	MembersWithLapsedLots(ctx context.Context, q database.Querier, now time.Time, after string, limit int) ([]string, error)

	PackageForPurchase(ctx context.Context, q database.Querier, id string) (*PackageForPurchase, error)
	// BranchPrice is the package's price override at branchID, nil when none.
	BranchPrice(ctx context.Context, q database.Querier, packageID, branchID string) (*float64, error)
	LivePurchaseCounts(ctx context.Context, q database.Querier, customerID string) (map[string]int, error)
	InsertPurchase(ctx context.Context, q database.Querier, p NewPurchase) (string, error)
	Purchase(ctx context.Context, q database.Querier, id string, lock bool) (*Purchase, error)
	PurchasesOf(ctx context.Context, q database.Querier, customerID string, limit int) ([]Purchase, error)
	PurchaseIDByReference(ctx context.Context, q database.Querier, referenceID string) (string, error)
	// PendingGatewayPurchases lists pending QRIS and invoice purchases created
	// at or before createdBefore, oldest first.
	PendingGatewayPurchases(ctx context.Context, q database.Querier, createdBefore time.Time, limit int) ([]Purchase, error)
	// MarkPurchasePaid returns paid_at and the package validity.
	MarkPurchasePaid(ctx context.Context, q database.Querier, id string, meta map[string]any) (time.Time, int, error)
	ClosePurchase(ctx context.Context, q database.Querier, id, status string) error
	// MarkPurchaseRefunded records the amount paid back, appends note and
	// merges meta into payment_meta.
	MarkPurchaseRefunded(ctx context.Context, q database.Querier, id, note string, amountIdr float64, meta map[string]any) error
	// PurchaseCompany is the company a purchase books to: its branch's,
	// else the only company; nil when neither resolves.
	PurchaseCompany(ctx context.Context, q database.Querier, id string) (*string, error)
	AttachQR(ctx context.Context, q database.Querier, id, referenceID string, meta map[string]any) error

	// InsertPass returns "" when the purchase already issued a pass.
	InsertPass(ctx context.Context, q database.Querier, p NewPass) (string, error)
	// LastPassEnd is the latest ends_at of the member's active or frozen
	// passes, nil when none.
	LastPassEnd(ctx context.Context, q database.Querier, customerID string) (*time.Time, error)
	// ExpireLapsedPasses flips active passes past ends_at to expired.
	ExpireLapsedPasses(ctx context.Context, q database.Querier, customerID string, now time.Time) error
	Passes(ctx context.Context, q database.Querier, customerID string) ([]PassRow, error)
	// Pass is nil when the pass does not exist; lock holds the row FOR UPDATE.
	Pass(ctx context.Context, q database.Querier, id string, lock bool) (*PassRow, error)
	PassByPurchase(ctx context.Context, q database.Querier, purchaseID string) (*PassRow, error)
	// ActivePassAt is the active pass covering at, nil when none.
	ActivePassAt(ctx context.Context, q database.Querier, customerID string, at time.Time) (*PassRow, error)
	RefundPassByPurchase(ctx context.Context, q database.Querier, purchaseID string) error
	FreezePass(ctx context.Context, q database.Querier, id string, at, until time.Time) error
	// ThawPass ends a freeze and moves ends_at out by days.
	ThawPass(ctx context.Context, q database.Querier, id string, days int) error
	ExtendPass(ctx context.Context, q database.Querier, id string, days int) error
	// ShiftQueuedPasses moves the member's active passes starting at or after
	// from (other than afterPassID) by `by`.
	ShiftQueuedPasses(ctx context.Context, q database.Querier, customerID, afterPassID string, from time.Time, by time.Duration) error
	// DueFrozenPasses lists frozen passes whose frozen_until has passed, of
	// one member ("" for all).
	DueFrozenPasses(ctx context.Context, q database.Querier, customerID string, now time.Time) ([]string, error)
	SetAutoRenew(ctx context.Context, q database.Querier, id string, on bool, with string) error
	InsertPassEvent(ctx context.Context, q database.Querier, e PassEvent) error
	FreezeDaysUsed(ctx context.Context, q database.Querier, customerID string, since time.Time) (int, error)
	RenewalCandidates(ctx context.Context, q database.Querier, now, until time.Time) ([]PassRow, error)
	// ClaimRenewal marks the pass renewal as handled; false when another run
	// already did or auto-renew is off.
	ClaimRenewal(ctx context.Context, q database.Querier, id string) (bool, error)
	ReleaseRenewal(ctx context.Context, q database.Querier, id string) error
	SetRenewalPurchase(ctx context.Context, q database.Querier, id, purchaseID string) error
	// ExpireAllLapsedPasses flips every active pass past ends_at to expired.
	ExpireAllLapsedPasses(ctx context.Context, q database.Querier, now time.Time) (int, error)
	// LockPassRevenue serializes pass revenue releases and pass refunds
	// until the transaction ends.
	LockPassRevenue(ctx context.Context, q database.Querier) error
	PassesWithRevenueDue(ctx context.Context, q database.Querier, now time.Time) ([]PassRevenue, error)
	InsertPassReleases(ctx context.Context, q database.Querier, releases []PassRelease) error
	PassRevenueReleased(ctx context.Context, q database.Querier, purchaseID string) (float64, error)

	Packages(ctx context.Context, q database.Querier) ([]PackageRow, error)
	ActivePackages(ctx context.Context, q database.Querier) ([]PortalPackageRow, error)
	// PublicPackages lists public active packages sold at branchID (or
	// everywhere), with the branch price applied.
	PublicPackages(ctx context.Context, q database.Querier, branchID *string) ([]PublicPlan, error)
	SavePackage(ctx context.Context, q database.Querier, p PackageInput, actorID string) (string, error)
	ReplaceBranchPrices(ctx context.Context, q database.Querier, packageID string, prices []BranchPrice) error
	// SetPackageStatus returns nil when the package does not exist.
	SetPackageStatus(ctx context.Context, q database.Querier, id, status string) (*PackageStatus, error)
	DeleteUnusedPackage(ctx context.Context, q database.Querier, id string) (deleted, exists bool, err error)

	// RulesFor returns the global row and the row of branchID (when set).
	RulesFor(ctx context.Context, q database.Querier, branchID *string) ([]RulesRow, error)
	AllRules(ctx context.Context, q database.Querier) ([]RulesRow, error)
	SaveGlobalRules(ctx context.Context, q database.Querier, rules json.RawMessage, actorID string) error
	SaveBranchRules(ctx context.Context, q database.Querier, branchID string, rules json.RawMessage, actorID string) error
	DeleteBranchRules(ctx context.Context, q database.Querier, branchID string) error

	SavedMethodStore
}
