package app

import (
	"context"
	"encoding/json"
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymdesk"
	"nuhabit/backend/internal/modules/memberportal"
	memberdomain "nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// gym-desk: member list and 360, staff notes, front desk registration, gym
// reports and the check-in log export.
func init() {
	Register(gymdesk.Name, func(d module.Deps) module.Module {
		now := d.Now
		if now == nil {
			now = time.Now
		}
		return gymdesk.New(d, gymdesk.Ports{
			Accounts:      gymDeskAccounts{now: now},
			Credits:       gymDeskCredits{svc: gymcredits.NewDefaultService(d, d.DB)},
			WaiverVersion: memberdomain.WaiverVersion,
		})
	})
}

// gymDeskAccounts registers and edits members through the member portal's
// front desk functions, which apply the self registration rules.
type gymDeskAccounts struct{ now func() time.Time }

var _ gymdesk.Accounts = gymDeskAccounts{}

func (a gymDeskAccounts) Register(ctx context.Context, db database.DB, m gymdesk.NewMember) (string, error) {
	return memberportal.RegisterAtDesk(ctx, db, memberportal.DeskMember(m), a.now())
}

func (a gymDeskAccounts) UpdateProfile(ctx context.Context, db database.DB, customerID string, p gymdesk.ProfilePatch) error {
	return memberportal.UpdateAtDesk(ctx, db, customerID, memberportal.DeskProfile(p), a.now())
}

// gymDeskCredits serves the member 360 credit block from gym-credits.
type gymDeskCredits struct{ svc *gymcredits.Service }

var _ gymdesk.Credits = gymDeskCredits{}

func (a gymDeskCredits) MemberCredits(ctx context.Context, customerID string) (json.RawMessage, error) {
	view, err := a.svc.MemberCredits(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return json.Marshal(view)
}

func (a gymDeskCredits) Expiring(ctx context.Context, q database.Querier, now time.Time, withinDays int) ([]gymdesk.CreditExpiry, error) {
	list, err := a.svc.ExpiringCredits(ctx, q, now, withinDays)
	out := make([]gymdesk.CreditExpiry, len(list))
	for i, e := range list {
		out[i] = gymdesk.CreditExpiry(e)
	}
	return out, err
}
