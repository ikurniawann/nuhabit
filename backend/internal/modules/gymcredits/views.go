package gymcredits

import (
	"encoding/json"
	"math"
	"time"
)

// JSTime marshals like a JS Date through JSON.stringify: UTC, milliseconds, "Z".
type JSTime time.Time

// MarshalJSON implements json.Marshaler.
func (t JSTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + isoString(time.Time(t)) + `"`), nil
}

func isoString(t time.Time) string {
	return t.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
}

func jsTimePtr(t *time.Time) *JSTime {
	if t == nil {
		return nil
	}
	v := JSTime(*t)
	return &v
}

// Purchase is CreditPurchaseRow: the PURCHASE_SELECT columns.
type Purchase struct {
	ID            string          `json:"id"`
	CustomerID    string          `json:"customer_id"`
	PackageID     string          `json:"package_id"`
	PackageName   string          `json:"package_name"`
	Kind          string          `json:"kind"`
	Credits       int             `json:"credits"`
	ValidityDays  int             `json:"validity_days"`
	PriceIdr      float64         `json:"price_idr"`
	DiscountIdr   float64         `json:"discount_idr"`
	TotalIdr      float64         `json:"total_idr"`
	Channel       string          `json:"channel"`
	PaymentMethod *string         `json:"payment_method"`
	Status        string          `json:"status"`
	ExternalID    *string         `json:"external_id"`
	PaymentMeta   json.RawMessage `json:"payment_meta"`
	BranchID      *string         `json:"branch_id"`
	Note          *string         `json:"note"`
	PaidAt        *JSTime         `json:"paid_at"`
	RefundedAt    *JSTime         `json:"refunded_at"`
	CreatedBy     *string         `json:"created_by"`
	CreatedAt     JSTime          `json:"created_at"`
}

// meta decodes payment_meta (an object; {} when unreadable).
func (p *Purchase) meta() map[string]any {
	m := map[string]any{}
	_ = json.Unmarshal(p.PaymentMeta, &m)
	return m
}

// MemberPurchaseView is memberPurchaseView: what the portal polls.
type MemberPurchaseView struct {
	ID            string  `json:"id"`
	Status        string  `json:"status"`
	PackageID     string  `json:"package_id"`
	PackageName   string  `json:"package_name"`
	Kind          string  `json:"kind"`
	Credits       int     `json:"credits"`
	ValidityDays  int     `json:"validity_days"`
	TotalIdr      float64 `json:"total_idr"`
	PaymentMethod *string `json:"payment_method"`
	QRString      any     `json:"qr_string"`
	InvoiceURL    any     `json:"invoice_url"`
	ExpiresAt     any     `json:"expires_at"`
	Simulated     bool    `json:"simulated"`
	PaidAt        *JSTime `json:"paid_at"`
	CreatedAt     JSTime  `json:"created_at"`
}

func memberPurchaseView(p *Purchase) *MemberPurchaseView {
	meta := p.meta()
	var qr, invoiceURL any
	if p.Status == "pending" {
		qr = meta["qr_string"]
		invoiceURL = meta["invoice_url"]
	}
	simulated, _ := meta["simulated"].(bool)
	return &MemberPurchaseView{
		ID:            p.ID,
		Status:        p.Status,
		PackageID:     p.PackageID,
		PackageName:   p.PackageName,
		Kind:          p.Kind,
		Credits:       p.Credits,
		ValidityDays:  p.ValidityDays,
		TotalIdr:      p.TotalIdr,
		PaymentMethod: p.PaymentMethod,
		QRString:      qr,
		InvoiceURL:    invoiceURL,
		ExpiresAt:     meta["expires_at"],
		Simulated:     simulated,
		PaidAt:        p.PaidAt,
		CreatedAt:     p.CreatedAt,
	}
}

// Package kinds (gym.credit_packages.kind).
const (
	KindCredits = "credits"
	KindPass    = "pass"
)

// BranchPrice overrides a package price at one branch.
type BranchPrice struct {
	BranchID string  `json:"branch_id"`
	PriceIdr float64 `json:"price_idr"`
}

// PackageRow is one package of the admin list (PACKAGE_SELECT).
type PackageRow struct {
	ID                     string        `json:"id"`
	Name                   string        `json:"name"`
	Description            string        `json:"description"`
	Kind                   string        `json:"kind"`
	Credits                int           `json:"credits"`
	PriceIdr               float64       `json:"price_idr"`
	ValidityDays           int           `json:"validity_days"`
	PurchaseLimitPerMember *int          `json:"purchase_limit_per_member"`
	ApplicableClassTypeIDs []string      `json:"applicable_class_type_ids"`
	BranchID               *string       `json:"branch_id"`
	BranchName             *string       `json:"branch_name"`
	IsPublic               bool          `json:"is_public"`
	Badge                  *string       `json:"badge"`
	BranchPrices           []BranchPrice `json:"branch_prices"`
	Status                 string        `json:"status"`
	SortOrder              int           `json:"sort_order"`
	CreatedAt              JSTime        `json:"created_at"`
	UpdatedAt              JSTime        `json:"updated_at"`
	SoldCount              int           `json:"sold_count"`
	Referenced             bool          `json:"referenced"`
}

// PortalPackageRow is an active package as the portal query reads it.
type PortalPackageRow struct {
	ID                     string
	Name                   string
	Description            string
	Kind                   string
	Credits                int
	PriceIdr               float64
	ValidityDays           int
	PurchaseLimitPerMember *int
	ApplicableClassTypeIDs []string
	BranchID               *string
	Badge                  *string
	Status                 string
}

// PassRow is one gym.member_passes row.
type PassRow struct {
	ID          string
	CustomerID  string
	PackageID   string
	PackageName string
	PurchaseID  *string
	StartsAt    time.Time
	EndsAt      time.Time
	Status      string
}

// PassView is a member pass as the wallet lists it.
type PassView struct {
	ID          string  `json:"id"`
	PackageID   string  `json:"package_id"`
	PackageName string  `json:"package_name"`
	StartsAt    JSTime  `json:"starts_at"`
	EndsAt      JSTime  `json:"ends_at"`
	Status      string  `json:"status"`
	DaysLeft    int     `json:"days_left"`
	PurchaseID  *string `json:"purchase_id"`
}

func passView(p PassRow, now time.Time) PassView {
	daysLeft := 0
	if p.Status == "active" && p.EndsAt.After(now) {
		daysLeft = int(math.Ceil(p.EndsAt.Sub(now).Hours() / 24))
	}
	return PassView{
		ID: p.ID, PackageID: p.PackageID, PackageName: p.PackageName, StartsAt: JSTime(p.StartsAt), EndsAt: JSTime(p.EndsAt),
		Status: p.Status, DaysLeft: daysLeft, PurchaseID: p.PurchaseID,
	}
}

// PublicPlan is one package of the public price list, priced for a branch.
type PublicPlan struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	Description  string  `json:"description"`
	Credits      int     `json:"credits"`
	ValidityDays int     `json:"validity_days"`
	PriceIdr     float64 `json:"price_idr"`
	Badge        *string `json:"badge"`
	SortOrder    int     `json:"sort_order"`
}

// PublicBranch is a branch as the public price list names it.
type PublicBranch struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Slug *string `json:"slug"`
}

// PublicPlansView is GET /api/public/site/plans.
type PublicPlansView struct {
	Branch *PublicBranch `json:"branch"`
	Plans  []PublicPlan  `json:"plans"`
}

// LotView is CreditLotView.
type LotView struct {
	ID          string  `json:"id"`
	PackageID   *string `json:"package_id"`
	PackageName *string `json:"package_name"`
	Credits     int     `json:"credits"`
	Remaining   int     `json:"remaining"`
	ExpiresAt   JSTime  `json:"expires_at"`
	CreatedAt   JSTime  `json:"created_at"`
	Expired     bool    `json:"expired"`
}

// EntryView is CreditEntryView.
type EntryView struct {
	ID              string  `json:"id"`
	Type            string  `json:"type"`
	Amount          int     `json:"amount"`
	LotID           *string `json:"lot_id"`
	SourceType      *string `json:"source_type"`
	SourceID        *string `json:"source_id"`
	ReversesEntryID *string `json:"reverses_entry_id"`
	Reversed        bool    `json:"reversed"`
	Note            *string `json:"note"`
	CreatedByName   *string `json:"created_by_name"`
	CreatedAt       JSTime  `json:"created_at"`
}

// WalletView is CreditWalletView.
type WalletView struct {
	Balance             int         `json:"balance"`
	ExpiringCredits     int         `json:"expiring_credits"`
	ExpiryReminderDays  int         `json:"expiry_reminder_days"`
	LowBalance          bool        `json:"low_balance"`
	LowBalanceThreshold int         `json:"low_balance_threshold"`
	Lots                []LotView   `json:"lots"`
	ExpiringLots        []LotView   `json:"expiring_lots"`
	Passes              []PassView  `json:"passes"`
	Entries             []EntryView `json:"entries"`
}

// MemberCreditsView is loadMemberCredits: { member, ...wallet, purchases }.
type MemberCreditsView struct {
	Member *MemberProfile `json:"member"`
	WalletView
	Purchases []Purchase `json:"purchases"`
}

// CreditMember is a search row: the customer plus its credit balance.
type CreditMember struct {
	MemberSummary
	Balance int `json:"balance"`
}

// PortalPackage is one package of the member portal list.
type PortalPackage struct {
	ID                     string  `json:"id"`
	Name                   string  `json:"name"`
	Description            string  `json:"description"`
	Kind                   string  `json:"kind"`
	Credits                int     `json:"credits"`
	PriceIdr               float64 `json:"price_idr"`
	ValidityDays           int     `json:"validity_days"`
	PurchaseLimitPerMember *int    `json:"purchase_limit_per_member"`
	Badge                  *string `json:"badge"`
	Restricted             bool    `json:"restricted"`
	CanBuy                 bool    `json:"can_buy"`
	BlockedReason          *string `json:"blocked_reason"`
}

// PortalPackagesView is GET /api/member-portal/gym/credits/packages.
type PortalPackagesView struct {
	Packages      []PortalPackage `json:"packages"`
	ArkEnabled    bool            `json:"ark_enabled"`
	ArkBalanceIdr float64         `json:"ark_balance_idr"`
	ArkRate       float64         `json:"ark_rate"`
	CanSimulate   bool            `json:"can_simulate"`
}
