package app

import (
	"context"

	"nuhabit/backend/internal/modules/gymcoaching"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// coachingStaff tells the staff account linked to a coach about PT
// requests: the dashboard inbox row on the caller's transaction, then
// WhatsApp and email through the gym channels, best effort.
type coachingStaff struct{ channels gymChannels }

var _ gymcoaching.StaffNotifier = coachingStaff{}

func newCoachingStaff(d module.Deps) coachingStaff {
	return coachingStaff{channels: newGymChannels(d)}
}

func (c coachingStaff) NotifyCoach(ctx context.Context, q database.Querier, coachID string, n gymcoaching.Notification) error {
	contact, err := gymcoaching.LookupCoachContact(ctx, q, coachID)
	if err != nil || contact == nil {
		return err
	}
	if err := gymcoaching.InboxNotice(ctx, q, contact.UserID, n); err != nil {
		return err
	}
	c.channels.SendTo(contact.Phone, contact.Email, n.Title, n.Body)
	return nil
}
