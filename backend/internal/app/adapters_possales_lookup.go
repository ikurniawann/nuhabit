package app

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymscheduling"
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
type posGymCheckIn struct {
	now   func() time.Time
	ports gymscheduling.Ports
}

var _ lookup.GymCheckIn = posGymCheckIn{}

func (g posGymCheckIn) CheckInAtPos(ctx context.Context, db database.DB, customerID, scannedBy string) (*lookup.GymCheckInResult, error) {
	svc := gymscheduling.NewService(db, gymscheduling.Postgres{}, g.ports, g.now)
	res, err := svc.CheckInBooking(ctx, customerID, &scannedBy, "pos")
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
