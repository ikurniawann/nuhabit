package gymcoachleave

import (
	"context"
	"strconv"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
)

// Staff notices go to the dashboard inbox (public.notifications), the bell
// every staff screen shows.

const (
	// portalLink opens the Cuti tab of Kelas Saya.
	portalLink = "/dashboard/gym/my-classes?tab=leave"
	// queueLink opens the Program Director's queue.
	queueLink = "/dashboard/gym/coach-leave"
)

// inboxNotice is one inbox row; Kind is the notifications type (approval,
// status_change, alert).
type inboxNotice struct {
	Title, Body, Link, Kind string
}

func notifyUser(ctx context.Context, q database.Querier, userID string, n inboxNotice) error {
	_, err := q.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata)
	    VALUES ($1, $2, $3, $4, $5, jsonb_build_object('source', 'gym_coach_leave'))`, userID, n.Title, n.Body, n.Kind, n.Link)
	return err
}

// notifyCoach writes to the account linked to a coach; nothing when the
// coach has no active account.
func notifyCoach(ctx context.Context, q database.Querier, coachID string, n inboxNotice) error {
	var userID *string
	err := q.QueryRow(ctx, `SELECT u.id::text FROM gym.coaches c JOIN configuration.users u ON u.id = c.user_id AND u.status = 'active'
	   WHERE c.id = $1`, coachID).Scan(&userID)
	if database.IsNoRows(err) || (err == nil && userID == nil) {
		return nil
	}
	if err != nil {
		return err
	}
	return notifyUser(ctx, q, *userID, n)
}

// when is the session start as "Sen, 2 Nov, 18.00" in its branch zone.
func when(c *Cover) string { return at(c.StartsAt, c.Timezone) }

func at(t time.Time, zone string) string { return localtime.Format(t, localtime.Zone(zone)) }

func itoa(n int) string { return strconv.Itoa(n) }
