package lookup

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/possales/lookup/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Ports are the cross-context ports internal/app wires. A nil Passes or
// MemberQr falls back to the stopgap SQL adapter in adapters_sql.go; a nil
// Gym leaves `gym` null in the member-qr response.
type Ports struct {
	Passes   SeasonPasses
	MemberQr MemberQrScanner
	Gym      GymCheckIn
}

// SeasonPasses reads issued season passes (owned by ticketing).
type SeasonPasses interface {
	// FindSeasonPass returns nil when no pass matches key.
	FindSeasonPass(ctx context.Context, q database.Querier, key domain.PassKey) (*domain.SeasonPass, error)
}

// QrScan is scanMemberQr's QrScanResult: Problem is "" when the QR was
// accepted, and then the customer fields are set.
type QrScan struct {
	Problem    domain.QrProblem
	CustomerID string
	Name       *string
	Phone      string
}

// MemberQrScanner consumes a member card QR at the till (owned by CRM).
// It logs every scan, accepted or denied, and consumes the token on success,
// all on q: the row lock and the consume must commit together so a QR only
// works once, and the denial log must commit even when the scan is refused.
type MemberQrScanner interface {
	ScanMemberQr(ctx context.Context, q database.Querier, token, scannedBy string, now time.Time) (QrScan, error)
}

// GymCheckIn checks a member scanned at the till into a confirmed gym class
// booking around now (owned by gym-scheduling). It runs in its own
// transaction on db, after the QR scan committed, like the TS route.
type GymCheckIn interface {
	CheckInAtPos(ctx context.Context, db database.DB, customerID, scannedBy string) (*GymCheckInResult, error)
}

// GymCheckInResult marshals like GymCheckInResult in
// lib/gym/gym-checkin-server.ts.
type GymCheckInResult struct {
	Decision        string         `json:"decision"`
	Reason          *string        `json:"reason"`
	EntryKind       *string        `json:"entryKind"`
	Message         string         `json:"message"`
	CustomerID      *string        `json:"customerId"`
	MemberName      *string        `json:"memberName"`
	Booking         *GymBookingRef `json:"booking"`
	CreditsDeducted int            `json:"creditsDeducted"`
	BalanceAfter    *int           `json:"balanceAfter"`
}

// GymBookingRef is the booking a check-in admitted.
type GymBookingRef struct {
	ID        string       `json:"id"`
	SessionID string       `json:"sessionId"`
	ClassName string       `json:"className"`
	StartsAt  httpx.JSTime `json:"startsAt"`
}
