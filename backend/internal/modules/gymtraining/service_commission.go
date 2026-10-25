package gymtraining

import (
	"context"
	"errors"
	"fmt"
	"time"

	"nuhabit/backend/internal/contracts/gym"
	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/outbox"
)

/* ── Ports ───────────────────────────────────────────────────────────── */

// CoachActivity is what one coach taught at one branch in a period.
type CoachActivity struct {
	CoachID, BranchID         string
	ClassSessions, PtSessions int
	Attendees                 int
}

// CommissionSources reads what revenue-share commission is computed from:
// the revenue gym-credits recognised and the sessions gym-scheduling and
// gym-coaching completed. Both run on q, the caller's pool or transaction.
type CommissionSources interface {
	// BranchRevenue is the class and PT revenue branchID recognised in
	// [start, end); fromDay and toDay (YYYY-MM-DD) bound the pass revenue
	// released by day.
	BranchRevenue(ctx context.Context, q database.Querier, branchID string, start, end time.Time, fromDay, toDay string) (classIDR, ptIDR float64, err error)
	// CoachActivity lists every coach's completed classes and PT sessions
	// in [start, end) per branch.
	CoachActivity(ctx context.Context, q database.Querier, start, end time.Time) ([]CoachActivity, error)
}

// Discipline reads coach discipline incidents (the coach leave and
// discipline context). Each incident of the month cuts the coach's
// commission by the scheme's percentage for its kind.
type Discipline interface {
	IncidentsFor(ctx context.Context, coachID, month string) ([]domain.Incident, error)
}

// NoDiscipline has no incidents: the default until discipline is wired.
type NoDiscipline struct{}

func (NoDiscipline) IncidentsFor(context.Context, string, string) ([]domain.Incident, error) {
	return nil, nil
}

// coachCommissionSource is hris.payroll_additions.source_type of a
// commission line paid through payroll.
const coachCommissionSource = "gym.coach_commission"

/* ── Views ───────────────────────────────────────────────────────────── */

// commissionView is one branch month: stored once approved, else computed
// from the books as they stand (status preview, or draft when saved).
type commissionView struct {
	BranchID    string                     `json:"branchId"`
	BranchName  string                     `json:"branchName"`
	PeriodMonth string                     `json:"periodMonth"`
	Status      string                     `json:"status"`
	StatementID *string                    `json:"statementId"`
	SchemeID    *string                    `json:"schemeId"`
	SchemeName  *string                    `json:"schemeName"`
	Settings    *domain.CommissionSettings `json:"settings"`
	// MonthOver: the month has ended in the branch zone, so it may be approved.
	MonthOver  bool              `json:"monthOver"`
	ComputedAt *domain.Timestamp `json:"computedAt"`
	ApprovedAt *domain.Timestamp `json:"approvedAt"`
	domain.CommissionPool
	Lines []storedLine `json:"lines"`

	companyID *string
	zone      *time.Location
}

func resolveCommissionScheme(schemes []commissionSchemeRow, branchID string) *commissionSchemeRow {
	var fallback *commissionSchemeRow
	for i := range schemes {
		switch s := &schemes[i]; {
		case s.BranchID != nil && *s.BranchID == branchID:
			if !s.IsActive {
				return nil
			}
			return s
		case s.BranchID == nil && s.IsActive:
			fallback = s
		}
	}
	return fallback
}

// commissionInputs is what every branch of one month shares.
type commissionInputs struct {
	schemes  []commissionSchemeRow
	profiles map[string]coachProfile
	names    map[string]string
}

func (s *Service) commissionInputs(ctx context.Context, repo Repository) (commissionInputs, error) {
	schemes, err := repo.CommissionSchemes(ctx)
	if err != nil {
		return commissionInputs{}, err
	}
	profiles, err := repo.CoachProfiles(ctx)
	if err != nil {
		return commissionInputs{}, err
	}
	coaches, err := s.sched.Coaches(ctx, nil)
	if err != nil {
		return commissionInputs{}, err
	}
	names := make(map[string]string, len(coaches))
	for _, c := range coaches {
		names[c.ID] = c.Name
	}
	return commissionInputs{schemes: schemes, profiles: profiles, names: names}, nil
}

// branchMonth computes one branch month from the books, or reads it once
// approved.
func (s *Service) branchMonth(ctx context.Context, repo Repository, in commissionInputs, b commissionBranch, month string, stored *storedStatement) (commissionView, error) {
	zone := localtime.Zone(b.Timezone)
	period, err := domain.MonthPeriodIn(month, zone)
	if err != nil {
		return commissionView{}, err
	}
	v := commissionView{
		BranchID: b.ID, BranchName: b.Name, PeriodMonth: month, Status: domain.CommissionPreview,
		MonthOver: !s.now().Before(period.End), Lines: []storedLine{}, companyID: b.CompanyID, zone: zone,
	}
	v.CommissionPool.Lines = []domain.CommissionLine{}
	if stored != nil {
		v.StatementID, v.Status = &stored.ID, stored.Status
		if stored.Status != domain.CommissionDraft {
			v.SchemeID, v.SchemeName, v.Settings = stored.SchemeID, &stored.SchemeName, &stored.Settings
			v.ComputedAt, v.ApprovedAt = &stored.ComputedAt, stored.ApprovedAt
			v.CommissionPool = domain.CommissionPool{
				ClassRevenueIDR: stored.ClassRevenueIDR, PtRevenueIDR: stored.PtRevenueIDR,
				ClassPoolIDR: stored.ClassPoolIDR, PtPoolIDR: stored.PtPoolIDR, TotalPoolIDR: stored.TotalPoolIDR,
				AllocatedPercent: stored.AllocatedPercent, AllocatedIDR: stored.AllocatedIDR, RetainedIDR: stored.RetainedIDR,
				OverAllocated: stored.AllocatedPercent > 100,
			}
			v.Lines, err = repo.CommissionLines(ctx, stored.ID)
			return v, err
		}
	}
	scheme := resolveCommissionScheme(in.schemes, b.ID)
	if scheme == nil {
		return v, nil
	}
	settings := scheme.settings()
	v.SchemeID, v.SchemeName, v.Settings = &scheme.ID, &scheme.Name, &settings

	end, err := domain.MonthEnd(month)
	if err != nil {
		return v, err
	}
	classIDR, ptIDR, err := s.commission.BranchRevenue(ctx, repo.Querier(), b.ID, period.Start, period.End, month+"-01", end)
	if err != nil {
		return v, err
	}
	activity, err := s.commission.CoachActivity(ctx, repo.Querier(), period.Start, period.End)
	if err != nil {
		return v, err
	}
	all := map[string]int{}
	for _, a := range activity {
		all[a.CoachID] += a.ClassSessions + a.PtSessions
	}
	var coaches []domain.CommissionCoach
	for _, a := range activity {
		if a.BranchID != b.ID {
			continue
		}
		incidents, err := s.discipline.IncidentsFor(ctx, a.CoachID, month)
		if err != nil {
			return v, err
		}
		p := in.profiles[a.CoachID]
		if p.Role == "" {
			p.Role = domain.RoleCoach
		}
		coaches = append(coaches, domain.CommissionCoach{
			CoachID: a.CoachID, Name: in.names[a.CoachID], Role: p.Role, ShareOverride: p.SharePercent,
			ClassSessions: a.ClassSessions, PtSessions: a.PtSessions, Attendees: a.Attendees,
			AllSessions: all[a.CoachID], Incidents: incidents,
		})
	}
	v.CommissionPool = domain.ComputeCommission(classIDR, ptIDR, settings, coaches)
	at := domain.At(s.now())
	v.ComputedAt = &at
	for _, l := range v.CommissionPool.Lines {
		v.Lines = append(v.Lines, storedLine{CommissionLine: l, Status: "pending"})
	}
	return v, nil
}

// Commission lists the month of every active branch, or of one branch.
func (s *Service) Commission(ctx context.Context, month string, branchID *string) ([]commissionView, error) {
	in, err := s.commissionInputs(ctx, s.repo)
	if err != nil {
		return nil, err
	}
	branches, err := s.repo.CommissionBranches(ctx, branchID)
	if err != nil {
		return nil, err
	}
	out := make([]commissionView, 0, len(branches))
	for _, b := range branches {
		stored, err := s.repo.CommissionStatement(ctx, b.ID, month, false)
		if err != nil {
			return nil, err
		}
		v, err := s.branchMonth(ctx, s.repo, in, b, month, stored)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	if branchID != nil && len(out) == 0 {
		return nil, httpx.NotFound("Cabang tidak ditemukan")
	}
	return out, nil
}

/* ── Draft and approval ──────────────────────────────────────────────── */

// Statement actions.
const (
	commissionActionDraft   = "draft"
	commissionActionApprove = "approve"
)

var commissionActions = []string{commissionActionDraft, commissionActionApprove}

func (s *Service) publishCommission(ctx context.Context, q database.Querier, j gym.CommissionJournal) error {
	if j.Amount <= 0 {
		return nil
	}
	return outbox.Publish(ctx, q, gym.TopicCommissionJournal, j.EventCode+":"+j.DocumentID, j)
}

// ActOnCommission saves the branch month as a draft (recomputed each time)
// or approves it: the numbers are locked, zero lines are settled and the
// accrual (commission expense to commission payable) goes to accounting,
// dated the last day of the month.
func (s *Service) ActOnCommission(ctx context.Context, userID, branchID, month, action string) (commissionView, error) {
	var out commissionView
	err := s.repo.InTx(ctx, func(tx Repository) error {
		branches, err := tx.CommissionBranches(ctx, &branchID)
		if err != nil {
			return err
		}
		if len(branches) == 0 {
			return httpx.NotFound("Cabang tidak ditemukan")
		}
		stored, err := tx.CommissionStatement(ctx, branchID, month, true)
		if err != nil {
			return err
		}
		if stored != nil && stored.Status != domain.CommissionDraft {
			return httpx.Conflict("Statement komisi bulan ini sudah disetujui.")
		}
		in, err := s.commissionInputs(ctx, tx)
		if err != nil {
			return err
		}
		v, err := s.branchMonth(ctx, tx, in, branches[0], month, nil)
		if err != nil {
			return err
		}
		if v.Settings == nil {
			return httpx.Conflict("Skema bagi hasil untuk cabang ini belum aktif.")
		}
		status := domain.CommissionDraft
		if action == commissionActionApprove {
			if refusal := domain.CheckApproval(v.Status, v.MonthOver, v.CommissionPool); refusal != "" {
				return httpx.Conflict(refusal)
			}
			status = domain.CommissionApproved
		}
		id, err := tx.SaveCommissionStatement(ctx, storedStatement{
			BranchID: branchID, PeriodMonth: month, SchemeID: v.SchemeID, SchemeName: *v.SchemeName, Status: status,
			PayoutChannel: v.Settings.PayoutChannel, ClassRevenueIDR: v.ClassRevenueIDR, PtRevenueIDR: v.PtRevenueIDR,
			ClassPoolPercent: v.Settings.ClassPoolPercent, PtPoolPercent: v.Settings.PtPoolPercent,
			ClassPoolIDR: v.ClassPoolIDR, PtPoolIDR: v.PtPoolIDR, TotalPoolIDR: v.TotalPoolIDR,
			AllocatedPercent: v.AllocatedPercent, AllocatedIDR: v.AllocatedIDR, RetainedIDR: v.RetainedIDR,
			Settings: *v.Settings, Lines: v.CommissionPool.Lines,
		}, userID)
		if err != nil {
			return err
		}
		if id == "" {
			return httpx.Conflict("Statement komisi bulan ini sudah disetujui.")
		}
		if status == domain.CommissionApproved {
			end, err := domain.MonthEnd(month)
			if err != nil {
				return err
			}
			if err := s.publishCommission(ctx, tx.Querier(), gym.CommissionJournal{
				EventCode: "GYM_COMMISSION_ACCRUAL", DocumentType: "gym_commission_statement", DocumentID: id,
				CompanyID: v.companyID, UserID: userID, EntryDate: end, Amount: v.AllocatedIDR,
				Description: fmt.Sprintf("Akrual komisi coach %s %s", branches[0].Name, month),
			}); err != nil {
				return err
			}
			if err := tx.CloseCommissionStatementIfPaid(ctx, id); err != nil {
				return err
			}
		}
		stored, err = tx.CommissionStatement(ctx, branchID, month, false)
		if err != nil {
			return err
		}
		out, err = s.branchMonth(ctx, tx, in, branches[0], month, stored)
		return err
	})
	return out, err
}

/* ── Paying a line ───────────────────────────────────────────────────── */

type commissionPayInput struct {
	Method           string
	PaymentReference *string
}

// PayCommissionLine pays one coach's line of an approved month. Through
// payroll it becomes a payroll addition (the coach must be a payable
// employee) and the payable moves to payroll; outside payroll it is paid in
// cash or by transfer. The statement closes when its last line is paid.
func (s *Service) PayCommissionLine(ctx context.Context, userID, lineID string, in commissionPayInput) error {
	return s.repo.InTx(ctx, func(tx Repository) error {
		line, err := tx.LockCommissionLine(ctx, lineID)
		if err != nil {
			return err
		}
		if line == nil {
			return httpx.NotFound("Baris komisi tidak ditemukan")
		}
		if refusal := domain.CheckLinePayment(line.StatementStatus, line.Status, line.PayoutChannel, in.Method, in.PaymentReference); refusal != "" {
			return httpx.Conflict(refusal)
		}
		now := s.now()
		zone := localtime.Zone(line.Timezone)
		journal := gym.CommissionJournal{
			DocumentType: "gym_commission_line", DocumentID: line.ID, CompanyID: line.CompanyID, UserID: userID,
			EntryDate: localtime.DayKey(now, zone), Amount: line.AmountIDR,
			Description: fmt.Sprintf("Komisi coach %s %s %s", line.CoachName, line.BranchName, line.PeriodMonth),
		}
		var period *string
		switch in.Method {
		case domain.PayByPayroll:
			journal.EventCode = "GYM_COMMISSION_PAYROLL"
			if line.AmountIDR > 0 {
				posted, err := s.payroll.PostIncentive(ctx, tx.Querier(), IncentivePosting{
					PayoutID: line.ID, CoachID: line.CoachID, PeriodMonth: line.PeriodMonth, AmountIDR: line.AmountIDR,
					FromMonth: domain.PeriodMonthOf(now), ActorID: userID, SourceType: coachCommissionSource,
					Label: "Komisi coach " + line.PeriodMonth + " " + line.BranchName,
				})
				switch {
				case errors.Is(err, ErrCoachNotEmployee):
					return httpx.Conflict("Coach ini belum tertaut ke karyawan HRIS. Tautkan akun staf coach ke data karyawan agar komisi masuk payroll.")
				case errors.Is(err, ErrEmployeeNotPayable):
					return httpx.Conflict("Karyawan coach ini nonaktif atau belum punya struktur gaji aktif, jadi payroll belum bisa membayar komisinya.")
				case err != nil:
					return err
				}
				period = &posted
			}
		case domain.PayByCash:
			journal.EventCode = "GYM_COMMISSION_PAYMENT_CASH"
		default:
			journal.EventCode = "GYM_COMMISSION_PAYMENT_BANK"
		}
		if in.PaymentReference != nil {
			journal.Description += " (" + *in.PaymentReference + ")"
		}
		if err := s.publishCommission(ctx, tx.Querier(), journal); err != nil {
			return err
		}
		if err := tx.MarkCommissionLinePaid(ctx, line.ID, in.Method, in.PaymentReference, period, userID, now); err != nil {
			return err
		}
		return tx.CloseCommissionStatementIfPaid(ctx, line.StatementID)
	})
}

/* ── Settings ────────────────────────────────────────────────────────── */

type commissionSchemeInput struct {
	ID                    *string
	BranchID              *string
	Name                  string
	ClassPoolPercent      float64
	PtPoolPercent         float64
	ShareHeadCoachPercent float64
	ShareCoachPercent     float64
	ShareAssistantPercent float64
	DeductionPercents     map[string]float64
	MaxDeductionPercent   float64
	PayoutChannel         string
	IsActive              bool
}

type commissionCoachView struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Status       string   `json:"status"`
	Role         string   `json:"role"`
	SharePercent *float64 `json:"sharePercent"`
}

type commissionBranchOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type commissionSettingsView struct {
	Schemes  []commissionSchemeRow     `json:"schemes"`
	Branches []commissionBranchOption  `json:"branches"`
	Coaches  []commissionCoachView     `json:"coaches"`
	Defaults domain.CommissionSettings `json:"defaults"`
}

// CommissionSettings is the scheme form: the default and branch schemes,
// the branches, and every coach with their role and share override.
func (s *Service) CommissionSettings(ctx context.Context) (commissionSettingsView, error) {
	out := commissionSettingsView{Defaults: domain.DefaultCommissionSettings,
		Branches: []commissionBranchOption{}, Coaches: []commissionCoachView{}}
	branches, err := s.repo.CommissionBranches(ctx, nil)
	if err != nil {
		return out, err
	}
	names := map[string]string{}
	for _, b := range branches {
		names[b.ID] = b.Name
		out.Branches = append(out.Branches, commissionBranchOption{ID: b.ID, Name: b.Name})
	}
	if out.Schemes, err = s.repo.CommissionSchemes(ctx); err != nil {
		return out, err
	}
	for i, sc := range out.Schemes {
		if sc.BranchID != nil {
			name := names[*sc.BranchID]
			out.Schemes[i].BranchName = &name
		}
	}
	profiles, err := s.repo.CoachProfiles(ctx)
	if err != nil {
		return out, err
	}
	coaches, err := s.sched.Coaches(ctx, nil)
	if err != nil {
		return out, err
	}
	for _, c := range coaches {
		p := profiles[c.ID]
		if p.Role == "" {
			p.Role = domain.RoleCoach
		}
		out.Coaches = append(out.Coaches, commissionCoachView{ID: c.ID, Name: c.Name, Status: c.Status, Role: p.Role, SharePercent: p.SharePercent})
	}
	return out, nil
}

// SaveCommissionScheme creates or edits a scheme: one default (no branch)
// and one per branch.
func (s *Service) SaveCommissionScheme(ctx context.Context, in commissionSchemeInput, actorID string) (map[string]string, error) {
	var id string
	err := s.repo.InTx(ctx, func(tx Repository) error {
		var err error
		id, err = tx.SaveCommissionScheme(ctx, in, actorID)
		return err
	})
	switch {
	case database.IsUniqueViolation(err):
		return nil, httpx.Conflict("Cabang ini sudah punya skema bagi hasil")
	case err != nil:
		return nil, err
	case id == "":
		return nil, httpx.NotFound("Skema bagi hasil tidak ditemukan")
	}
	return map[string]string{"id": id}, nil
}

func (s *Service) DeleteCommissionScheme(ctx context.Context, id string) error {
	found, err := s.repo.DeleteCommissionScheme(ctx, id)
	return notFoundUnless(found, err, "Skema bagi hasil tidak ditemukan atau skema default (tidak bisa dihapus)")
}

func (s *Service) SaveCoachProfile(ctx context.Context, coachID, role string, share *float64, actorID string) error {
	coaches, err := s.sched.Coaches(ctx, &coachID)
	if err != nil {
		return err
	}
	if len(coaches) == 0 {
		return httpx.NotFound("Coach tidak ditemukan")
	}
	return s.repo.SaveCoachProfile(ctx, coachID, role, share, actorID)
}

/* ── Coach portal ────────────────────────────────────────────────────── */

type myCommissionLine struct {
	storedLine
	BranchID        string  `json:"branchId"`
	BranchName      string  `json:"branchName"`
	PeriodMonth     string  `json:"periodMonth"`
	StatementStatus string  `json:"statementStatus"`
	SchemeName      string  `json:"schemeName"`
	TotalPoolIDR    float64 `json:"totalPoolIdr"`
}

type myCommission struct {
	Coach   *CatalogEntry        `json:"coach"`
	Month   []myCommissionLine   `json:"month"`
	History []coachCommissionRow `json:"history"`
}

// MyCommission is the caller's coach line at every branch for the month
// (running while the month is open) and their stored lines, read-only.
func (s *Service) MyCommission(ctx context.Context, userID, month string) (myCommission, error) {
	out := myCommission{Month: []myCommissionLine{}, History: []coachCommissionRow{}}
	coachID, err := s.sched.CoachForUser(ctx, userID)
	if err != nil || coachID == "" {
		return out, err
	}
	coaches, err := s.sched.Coaches(ctx, &coachID)
	if err != nil {
		return out, err
	}
	if len(coaches) > 0 {
		out.Coach = &coaches[0]
	}
	views, err := s.Commission(ctx, month, nil)
	if err != nil {
		return out, err
	}
	for _, v := range views {
		for _, l := range v.Lines {
			if l.CoachID == coachID {
				out.Month = append(out.Month, myCommissionLine{storedLine: l, BranchID: v.BranchID, BranchName: v.BranchName,
					PeriodMonth: month, StatementStatus: v.Status, SchemeName: deref(v.SchemeName), TotalPoolIDR: v.TotalPoolIDR})
			}
		}
	}
	out.History, err = s.repo.CoachCommissionHistory(ctx, coachID)
	return out, err
}
