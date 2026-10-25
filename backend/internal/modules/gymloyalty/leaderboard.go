package gymloyalty

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymloyalty/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// The monthly attendance leaderboard of a branch: sessions attended this
// month, ranked. It reuses the member app's leaderboard privacy setting
// (gym.athlete_settings.show_on_leaderboard, on unless the member turns it
// off) and leaves out frozen members. Names show as "Maya K.".

// Branch is a branch the leaderboard can show.
type Branch struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// LeaderboardEntry is one visible member.
type LeaderboardEntry struct {
	Rank     int     `json:"rank"`
	Alias    string  `json:"alias"`
	Sessions int     `json:"sessions"`
	TierName *string `json:"tier_name"`
	Me       bool    `json:"me"`
}

// LeaderboardMe is the viewing member's own line, shown even when hidden.
type LeaderboardMe struct {
	Sessions int  `json:"sessions"`
	Rank     *int `json:"rank"`
	Visible  bool `json:"visible"`
	// ShowOnLeaderboard is the member's privacy setting.
	ShowOnLeaderboard bool `json:"show_on_leaderboard"`
}

// LeaderboardView is one branch and month.
type LeaderboardView struct {
	Branch   *Branch            `json:"branch"`
	Branches []Branch           `json:"branches"`
	Month    string             `json:"month"`
	Entries  []LeaderboardEntry `json:"entries"`
	Me       *LeaderboardMe     `json:"me"`
}

// leaderboardSize is how many visible members the board lists.
const leaderboardSize = 20

// Leaderboard ranks branchID's members for month (YYYY-MM, "" for this
// month in the branch zone). customerID is the viewing member, "" for staff.
// Without a branch it picks the member's most attended branch this month,
// else the first active branch.
func (s *Service) Leaderboard(ctx context.Context, branchID, customerID, month string) (LeaderboardView, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, name FROM configuration.branches WHERE is_active ORDER BY name`)
	if err != nil {
		return LeaderboardView{}, err
	}
	branches, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Branch, error) {
		var b Branch
		err := r.Scan(&b.ID, &b.Name)
		return b, err
	})
	if err != nil {
		return LeaderboardView{}, err
	}
	view := LeaderboardView{Branches: branches, Entries: []LeaderboardEntry{}}
	if branchID == "" && customerID != "" {
		from := monthStart(s.now(), memberZone)
		err := s.db.QueryRow(ctx, `SELECT branch_id::text FROM (`+attendedSQL+`) a
			WHERE customer_id = $3 AND branch_id IS NOT NULL GROUP BY branch_id ORDER BY count(*) DESC, max(starts_at) DESC LIMIT 1`,
			from, from.AddDate(0, 1, 0), customerID).Scan(&branchID)
		if err != nil && !database.IsNoRows(err) {
			return view, err
		}
	}
	for i := range branches {
		if branches[i].ID == branchID || (branchID == "" && i == 0) {
			view.Branch = &branches[i]
		}
	}
	if view.Branch == nil {
		if branchID != "" {
			return view, httpx.NotFound("Cabang tidak ditemukan")
		}
		return view, nil
	}
	zone, err := localtime.BranchZone(ctx, s.db, &view.Branch.ID)
	if err != nil {
		return view, err
	}
	from := monthStart(s.now(), zone)
	if month != "" {
		t, err := time.ParseInLocation("2006-01", month, zone)
		if err != nil {
			return view, httpx.BadRequest("Bulan tidak valid (format YYYY-MM)")
		}
		from = t
	}
	view.Month = from.Format("2006-01")
	rows, err = s.db.Query(ctx, `SELECT a.customer_id::text, COALESCE(c.name, ''), count(*)::int,
		COALESCE(st.show_on_leaderboard, true), ms.status, ms.suspended_until, t.name
		FROM (`+attendedSQL+`) a
		JOIN pos.pos_customers c ON c.id = a.customer_id
		LEFT JOIN gym.athlete_settings st ON st.customer_id = a.customer_id
		LEFT JOIN gym.member_status ms ON ms.customer_id = a.customer_id
		LEFT JOIN gym.member_memberships m ON m.customer_id = a.customer_id
		LEFT JOIN gym.membership_tiers t ON t.id = m.tier_id AND t.is_active
		WHERE a.branch_id = $3
		GROUP BY a.customer_id, c.name, st.show_on_leaderboard, ms.status, ms.suspended_until, t.name
		ORDER BY count(*) DESC, c.name, a.customer_id`, from, from.AddDate(0, 1, 0), view.Branch.ID)
	if err != nil {
		return view, err
	}
	type line struct {
		id, name string
		sessions int
		shown    bool
		standing domain.Standing
		tier     *string
	}
	lines, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (line, error) {
		var l line
		var status *domain.Status
		err := r.Scan(&l.id, &l.name, &l.sessions, &l.shown, &status, &l.standing.SuspendedUntil, &l.tier)
		if status != nil {
			l.standing.Status = *status
		}
		return l, err
	})
	if err != nil {
		return view, err
	}
	now := s.now()
	var visible []line
	for _, l := range lines {
		if l.shown && !l.standing.Frozen(now) {
			visible = append(visible, l)
		}
	}
	counts := make([]int, len(visible))
	for i, l := range visible {
		counts[i] = l.sessions
	}
	ranks := domain.CompetitionRanks(counts)
	for i, l := range visible {
		if i == leaderboardSize {
			break
		}
		view.Entries = append(view.Entries, LeaderboardEntry{
			Rank: ranks[i], Alias: domain.LeaderboardAlias(l.name), Sessions: l.sessions, TierName: l.tier, Me: l.id == customerID,
		})
	}
	if customerID == "" {
		return view, nil
	}
	me := &LeaderboardMe{ShowOnLeaderboard: true}
	if err := s.db.QueryRow(ctx, `SELECT COALESCE((SELECT show_on_leaderboard FROM gym.athlete_settings WHERE customer_id = $1), true)`,
		customerID).Scan(&me.ShowOnLeaderboard); err != nil {
		return view, err
	}
	for i, l := range visible {
		if l.id == customerID {
			me.Visible, me.Rank = true, &ranks[i]
		}
	}
	for _, l := range lines {
		if l.id == customerID {
			me.Sessions = l.sessions
		}
	}
	if !me.Visible && me.Sessions > 0 {
		// Where the member would stand if shown.
		rank := 1
		for _, l := range visible {
			if l.sessions > me.Sessions {
				rank++
			}
		}
		me.Rank = &rank
	}
	view.Me = me
	return view, nil
}
