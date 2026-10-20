package gymtraining

import (
	"context"
	"log/slog"
	"slices"
	"time"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Ports ───────────────────────────────────────────────────────────── */

// Notification is an in-app message to a member.
type Notification struct {
	Type  string
	Title string
	Body  string
}

// Notifier delivers member notifications (the gym notifier owned by CRM).
type Notifier interface {
	NotifyMember(ctx context.Context, q database.Querier, customerID string, n Notification) error
}

// resultsRepository is the HYROX results part of Repository.
type resultsRepository interface {
	// Querier is the pool, or the transaction inside InTx.
	Querier() database.Querier

	RaceForResult(ctx context.Context, raceEventID string) (*raceForResult, error)
	SimulationSession(ctx context.Context, customerID, sessionID string) (*simulationSession, error)
	OpenSimulations(ctx context.Context, customerID string) ([]simulationSession, error)
	OpenResultRaces(ctx context.Context, customerID string, now time.Time) ([]resultRaceOption, error)
	LockLiveMemberRace(ctx context.Context, customerID, raceEventID string) (*string, error)
	InsertResult(ctx context.Context, customerID string, in resultInput, memberRaceID *string, totals domain.Totals, racedAt time.Time) (string, error)
	LockResult(ctx context.Context, customerID, id string) (*resultView, error)
	MemberResult(ctx context.Context, customerID, id string) (*resultView, error)
	UpdateResult(ctx context.Context, id string, w resultWrite) error
	SetMemberRaceResult(ctx context.Context, memberRaceID string, totalSec int) error
	InsertEntryResult(ctx context.Context, entryID string) error
	SetNotifiedPRs(ctx context.Context, id string, keys []string) error
	MemberResults(ctx context.Context, customerID string, division *string) ([]resultView, error)
	DivisionResults(ctx context.Context, division string) ([]resultView, error)
	BoardCandidates(ctx context.Context) ([]boardCandidateRow, error)
	ShowsOnLeaderboard(ctx context.Context, customerID string) (bool, error)
	ResultsAdmin(ctx context.Context, raceEventID *string, verified *bool) ([]resultAdminView, error)
	VerifyResult(ctx context.Context, id, userID string, verified bool) (bool, error)
}

// boardSize caps a leaderboard; the viewer's rank is returned either way.
const boardSize = 100

/* ── Member: log and edit ────────────────────────────────────────────── */

// prNotice is a PR notification to send once the save commits.
type prNotice struct {
	customerID string
	n          Notification
}

// CreateResult logs a race result (from the calendar) or a full simulation.
// A race result marks the member's race entry raced with the total.
func (s *Service) CreateResult(ctx context.Context, customerID string, in resultInput) (map[string]string, error) {
	totals, refusal := domain.ComputeTotals(in.Splits, in.OfficialTotalSec)
	if refusal != "" {
		return nil, httpx.BadRequest(refusal)
	}
	var id string
	var notice *prNotice
	err := s.repo.InTx(ctx, func(tx Repository) error {
		racedAt, where, memberRaceID, err := s.resultSubject(ctx, tx, customerID, in)
		if err != nil {
			return err
		}
		id, err = tx.InsertResult(ctx, customerID, in, memberRaceID, totals, racedAt)
		switch {
		case database.IsUniqueViolation(err) && in.Source == "race":
			return httpx.Conflict("Hasil race ini sudah dicatat. Ubah hasil yang ada.")
		case database.IsUniqueViolation(err):
			return httpx.Conflict("Simulasi ini sudah dicatat.")
		case err != nil:
			return err
		}
		if memberRaceID != nil {
			if err := tx.SetMemberRaceResult(ctx, *memberRaceID, totals.TotalSec); err != nil {
				return err
			}
		}
		saved, err := tx.LockResult(ctx, customerID, id)
		if err != nil {
			return err
		}
		notice, err = s.recordPRs(ctx, tx, *saved, where)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.notify(ctx, notice)
	return map[string]string{"id": id}, nil
}

// resultSubject checks what a new result is of and returns when it was
// raced, its name for the PR notification and the race entry to update.
func (s *Service) resultSubject(ctx context.Context, tx Repository, customerID string, in resultInput) (time.Time, string, *string, error) {
	if in.Source == "simulation" {
		sim, err := tx.SimulationSession(ctx, customerID, *in.WorkoutSessionID)
		if err != nil {
			return time.Time{}, "", nil, err
		}
		if sim == nil {
			return time.Time{}, "", nil, httpx.NotFound("Simulasi tidak ditemukan")
		}
		if sim.Type != "FULL_SIMULATION" || sim.Status != "completed" || sim.EndedAt == nil {
			return time.Time{}, "", nil, httpx.Conflict("Hanya simulasi penuh yang sudah selesai yang bisa dicatat.")
		}
		return *sim.EndedAt, "simulasi HYROX", nil, nil
	}
	race, err := tx.RaceForResult(ctx, *in.RaceEventID)
	if err != nil {
		return time.Time{}, "", nil, err
	}
	if race == nil {
		return time.Time{}, "", nil, httpx.NotFound("Race tidak ditemukan")
	}
	if race.Status == "cancelled" || race.StartsAt.After(s.now()) {
		return time.Time{}, "", nil, httpx.Conflict("Hasil bisa dicatat setelah race dimulai.")
	}
	entry, err := tx.LockLiveMemberRace(ctx, customerID, *in.RaceEventID)
	return race.StartsAt, race.Name, entry, err
}

// UpdateResult saves the member's edit of their own result. The result
// needs verifying again.
func (s *Service) UpdateResult(ctx context.Context, customerID, id string, in resultFields) error {
	totals, refusal := domain.ComputeTotals(in.Splits, in.OfficialTotalSec)
	if refusal != "" {
		return httpx.BadRequest(refusal)
	}
	var notice *prNotice
	err := s.repo.InTx(ctx, func(tx Repository) error {
		current, err := tx.LockResult(ctx, customerID, id)
		if err != nil {
			return err
		}
		if current == nil {
			return httpx.NotFound("Hasil tidak ditemukan")
		}
		if err := tx.UpdateResult(ctx, id, resultWrite{resultFields: in, Totals: totals}); err != nil {
			return err
		}
		if current.MemberRaceID != nil {
			if err := tx.SetMemberRaceResult(ctx, *current.MemberRaceID, totals.TotalSec); err != nil {
				return err
			}
		}
		saved, err := tx.LockResult(ctx, customerID, id)
		if err != nil {
			return err
		}
		where := "simulasi HYROX"
		if saved.RaceName != nil {
			where = *saved.RaceName
		}
		notice, err = s.recordPRs(ctx, tx, *saved, where)
		return err
	})
	if err == nil {
		s.notify(ctx, notice)
	}
	return err
}

// recordPRs finds the splits of saved that beat the member's earlier bests
// in its division and returns the notification for those not notified yet.
func (s *Service) recordPRs(ctx context.Context, tx Repository, saved resultView, where string) (*prNotice, error) {
	mine, err := tx.MemberResults(ctx, saved.CustomerID, &saved.Division)
	if err != nil {
		return nil, err
	}
	records := make([]domain.ResultRecord, len(mine))
	for i, r := range mine {
		records[i] = r.record()
	}
	current := saved.record()
	fresh := domain.UnnotifiedPRs(domain.NewPRs(current.Values, domain.PreviousBests(current, records)), saved.NotifiedPRs)
	if len(fresh) == 0 {
		return nil, nil
	}
	if err := tx.SetNotifiedPRs(ctx, saved.ID, append(slices.Clone(saved.NotifiedPRs), fresh...)); err != nil {
		return nil, err
	}
	return &prNotice{customerID: saved.CustomerID, n: Notification{
		Type:  "hyrox_pr",
		Title: "Rekor pribadi baru!",
		Body:  domain.PRNotificationBody(fresh, current.Values, where),
	}}, nil
}

// notify sends a PR notification after the save committed; a failure is
// logged and never undoes the save.
func (s *Service) notify(ctx context.Context, notice *prNotice) {
	if notice == nil || s.notifier == nil {
		return
	}
	if err := s.notifier.NotifyMember(ctx, s.repo.Querier(), notice.customerID, notice.n); err != nil {
		slog.Default().ErrorContext(ctx, "gym-training: PR notification failed", "customer", notice.customerID, "err", err)
	}
}

/* ── Member: read ────────────────────────────────────────────────────── */

// MyResults lists the member's results with the races and simulations they
// can still log.
func (s *Service) MyResults(ctx context.Context, customerID string) (myResults, error) {
	results, err := s.repo.MemberResults(ctx, customerID, nil)
	if err != nil {
		return myResults{}, err
	}
	races, err := s.repo.OpenResultRaces(ctx, customerID, s.now())
	if err != nil {
		return myResults{}, err
	}
	sims, err := s.repo.OpenSimulations(ctx, customerID)
	if err != nil {
		return myResults{}, err
	}
	options := []simulationOption{}
	if len(sims) > 0 {
		lib, err := s.repo.Library(ctx)
		if err != nil {
			return myResults{}, err
		}
		stationOrder := func(exerciseID string) *int {
			for _, e := range lib.Exercises {
				if e.ID == exerciseID {
					return e.HyroxStationOrder
				}
			}
			return nil
		}
		for _, sim := range sims {
			splits := domain.SimulationSplits(sim.Blocks, sim.BlockResults, stationOrder)
			options = append(options, simulationOption{
				SessionID: sim.ID, EndedAt: domain.At(*sim.EndedAt), Division: sim.Division, ActiveSec: sim.ActiveSec,
				RunSec: splits.Runs[:], StationSec: splits.Stations[:],
			})
		}
	}
	return myResults{Results: results, Races: races, Simulations: options}, nil
}

// ResultDetail is one of the member's results with each split against their
// best before it and the gym average in the division.
func (s *Service) ResultDetail(ctx context.Context, customerID, id string) (resultDetail, error) {
	result, err := s.repo.MemberResult(ctx, customerID, id)
	if err != nil {
		return resultDetail{}, err
	}
	if result == nil {
		return resultDetail{}, httpx.NotFound("Hasil tidak ditemukan")
	}
	mine, err := s.repo.MemberResults(ctx, customerID, &result.Division)
	if err != nil {
		return resultDetail{}, err
	}
	division, err := s.repo.DivisionResults(ctx, result.Division)
	if err != nil {
		return resultDetail{}, err
	}
	records := make([]domain.ResultRecord, len(mine))
	for i, r := range mine {
		records[i] = r.record()
	}
	values := make([]map[string]int, len(division))
	for i, r := range division {
		values[i] = r.record().Values
	}
	current := result.record()
	previous := domain.PreviousBests(current, records)
	averages := domain.SplitAverages(values)
	prs := domain.NewPRs(current.Values, previous)

	lookup := func(m map[string]int, key string) *int {
		if v, ok := m[key]; ok {
			return &v
		}
		return nil
	}
	splits := []splitCompare{}
	for _, key := range domain.SplitKeys() {
		splits = append(splits, splitCompare{
			Key: key, Sec: lookup(current.Values, key), PreviousBestSec: lookup(previous, key),
			GymAverageSec: lookup(averages, key), IsPR: slices.Contains(prs, key),
		})
	}
	return resultDetail{Result: *result, Splits: splits}, nil
}

/* ── Leaderboards (member and staff) ─────────────────────────────────── */

// Leaderboard ranks best results. viewerID is the member asking ("" for
// staff, who also see customer ids).
func (s *Service) Leaderboard(ctx context.Context, viewerID string, q boardQuery) (leaderboardView, error) {
	rows, err := s.repo.BoardCandidates(ctx)
	if err != nil {
		return leaderboardView{}, err
	}
	raceNames := map[string]*string{}
	years := []int{}
	candidates := make([]domain.BoardCandidate, len(rows))
	for i, r := range rows {
		c := domain.BoardCandidate{ResultID: r.ResultID, CustomerID: r.CustomerID, Source: r.Source, RaceEventID: r.RaceEventID,
			Division: r.Division, AgeGroup: r.AgeGroup, TotalSec: r.TotalSec, RacedAt: r.RacedAt, Verified: r.Verified, Visible: r.Visible}
		copy(c.StationSec[:], r.StationSec)
		candidates[i] = c
		raceNames[r.ResultID] = r.RaceName
		if year := domain.ResultYear(r.RacedAt); !slices.Contains(years, year) {
			years = append(years, year)
		}
	}
	slices.Sort(years)
	slices.Reverse(years)

	board := domain.Leaderboard(candidates, q.Filter, q.Station)
	view := leaderboardView{Rows: []boardRowView{}, Years: years}
	ids := []string{}
	for _, row := range board {
		if row.CustomerID == viewerID {
			view.MyRank = ptrTo(row.Rank)
		}
		if len(ids) < boardSize {
			ids = append(ids, row.CustomerID)
		}
	}
	contacts, err := s.customers.Contacts(ctx, ids)
	if err != nil {
		return leaderboardView{}, err
	}
	for _, row := range board[:len(ids)] {
		v := boardRowView{
			Rank: row.Rank, ResultID: row.ResultID, Name: "Member", IsMe: row.CustomerID == viewerID,
			Division: row.Division, AgeGroup: row.AgeGroup, Source: row.Source, RaceName: raceNames[row.ResultID],
			ValueSec: row.ValueSec, TotalSec: row.TotalSec, RacedAt: domain.At(row.RacedAt), Verified: row.Verified,
		}
		if c, ok := contacts[row.CustomerID]; ok && c.Name != nil && *c.Name != "" {
			v.Name = *c.Name
		}
		if viewerID == "" {
			v.CustomerID = row.CustomerID
		}
		view.Rows = append(view.Rows, v)
	}
	if viewerID != "" {
		show, err := s.repo.ShowsOnLeaderboard(ctx, viewerID)
		if err != nil {
			return leaderboardView{}, err
		}
		view.Hidden = !show
	}
	return view, nil
}

/* ── Staff: results and verification ─────────────────────────────────── */

// ResultsAdmin lists results for verification with the member's contact.
func (s *Service) ResultsAdmin(ctx context.Context, raceEventID *string, verified *bool) ([]resultAdminView, error) {
	rows, err := s.repo.ResultsAdmin(ctx, raceEventID, verified)
	if err != nil || len(rows) == 0 {
		return rows, err
	}
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.CustomerID
	}
	contacts, err := s.customers.Contacts(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if c, ok := contacts[rows[i].CustomerID]; ok {
			rows[i].Name, rows[i].Phone = c.Name, c.Phone
		}
	}
	return rows, nil
}

// VerifyResult sets or clears a result's verified badge.
func (s *Service) VerifyResult(ctx context.Context, userID, id string, verified bool) error {
	found, err := s.repo.VerifyResult(ctx, id, userID, verified)
	return notFoundUnless(found, err, "Hasil tidak ditemukan")
}
