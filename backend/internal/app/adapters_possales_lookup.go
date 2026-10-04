package app

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymscheduling"
	scheddomain "nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/modules/possales/lookup"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// possalesLookupPorts adapts other modules to the pos-sales lookup ports.
// Season passes and the member QR scan keep the package's stopgap SQL
// adapters until ticketing and CRM expose those operations.
func possalesLookupPorts(d module.Deps) lookup.Ports {
	credits := schedulingCredits{svc: gymcredits.NewDefaultService(d, d.DB)}
	return lookup.Ports{Gym: posGymCheckIn{
		now: d.Now,
		ports: gymscheduling.Ports{
			Credits:  credits,
			Packages: credits,
			Rules:    credits,
			Members:  gymscheduling.MembersSQL{},
			Notifier: gymscheduling.NotificationsSQL{},
		},
	}}
}

// posGymCheckIn runs gym-scheduling's gate pipeline for a member whose card
// QR the till already accepted: checkInBooking(client, {customerId,
// scannedBy, source: "pos"}) in lib/gym/gym-checkin-server.ts.
//
// gym-scheduling exports only ScanQr, which validates a QR token first and
// logs the access as source "gate". The adapter feeds it a token that is
// already valid for this customer (the CRM scan consumed the real one) and
// stamps the access log with source "pos". Replace this with an exported
// gym-scheduling CheckInBooking(customerID, source) once it exists.
type posGymCheckIn struct {
	now   func() time.Time
	ports gymscheduling.Ports
}

var _ lookup.GymCheckIn = posGymCheckIn{}

func (g posGymCheckIn) CheckInAtPos(ctx context.Context, db database.DB, customerID, scannedBy string) (*lookup.GymCheckInResult, error) {
	ports := g.ports
	ports.Qr = acceptedQr{customerID: customerID}
	svc := gymscheduling.NewService(db, posAccessLog{}, ports, g.now)
	res, err := svc.ScanQr(ctx, "", nil, &scannedBy)
	if err != nil {
		return nil, err
	}
	out := &lookup.GymCheckInResult{
		Decision:        string(res.Decision),
		Reason:          (*string)(res.Reason),
		EntryKind:       (*string)(res.EntryKind),
		Message:         res.Message,
		CustomerID:      res.CustomerID,
		MemberName:      res.MemberName,
		CreditsDeducted: res.CreditsDeducted,
		BalanceAfter:    res.BalanceAfter,
	}
	if b := res.Booking; b != nil {
		out.Booking = &lookup.GymBookingRef{ID: b.ID, SessionID: b.SessionID, ClassName: b.ClassName, StartsAt: httpx.JSTime(b.StartsAt)}
	}
	return out, nil
}

// acceptedQr stands in for crm.member_qr_tokens: the till's QR was already
// validated and consumed, so the gate sees a live, unconsumed token, and
// there is nothing left to consume (ScanQr skips Consume for an empty token).
type acceptedQr struct{ customerID string }

func (q acceptedQr) Lock(context.Context, database.Querier, string) (*scheddomain.QrToken, error) {
	return &scheddomain.QrToken{CustomerID: q.customerID, ExpiresAt: time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)}, nil
}

func (acceptedQr) Consume(context.Context, database.Querier, string, time.Time) error { return nil }

// posAccessLog writes gym.access_logs rows with source "pos".
type posAccessLog struct{ gymscheduling.Postgres }

func (p posAccessLog) LogAccess(ctx context.Context, q database.Querier, e gymscheduling.AccessEntry) error {
	e.Source = "pos"
	return p.Postgres.LogAccess(ctx, q, e)
}
