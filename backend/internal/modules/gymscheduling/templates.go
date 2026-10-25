package gymscheduling

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// Weekly schedule templates and the generator that turns them into dated
// sessions. A template never changes sessions it already generated.

// TemplateInput is a new or edited template; nil duration, capacity and
// cost fall back to the class type.
type TemplateInput struct {
	ClassTypeID             string
	CoachID, BranchID, Area *string
	Weekday                 int
	StartTime               string
	DurationMin             *int
	Capacity                *int
	CreditCost              *int
	ValidFrom               string // "" is today in the branch zone
	ValidUntil              *string
	Active                  bool
	SkipHolidays            bool
}

// TemplatePatch is a partial TemplateInput: nil keeps the stored value.
type TemplatePatch struct {
	ClassTypeID             *string
	CoachID, BranchID, Area Optional[string]
	Weekday                 *int
	StartTime               *string
	DurationMin             *int
	Capacity                *int
	CreditCost              *int
	ValidFrom               *string
	ValidUntil              Optional[string]
	Active                  *bool
	SkipHolidays            *bool
}

var errTemplateNotFound = httpx.NotFound("Template jadwal tidak ditemukan")

// ListTemplates is {templates, branches}; branches feed the form.
func (s *Service) ListTemplates(ctx context.Context) (*Row, error) {
	templates, err := s.repo.ListTemplates(ctx, s.db)
	if err != nil {
		return nil, err
	}
	branches, err := s.repo.Branches(ctx, s.db)
	if err != nil {
		return nil, err
	}
	return object("templates", templates, "branches", branches), nil
}

func (s *Service) CreateTemplate(ctx context.Context, in TemplateInput, createdBy *string) (id string, err error) {
	err = s.inTx(ctx, func(q Q) error {
		id, err = s.createTemplate(ctx, q, in, createdBy)
		return err
	})
	return id, err
}

// createTemplate is CreateTemplate on q, for callers in a transaction.
func (s *Service) createTemplate(ctx context.Context, q Q, in TemplateInput, createdBy *string) (string, error) {
	def, err := s.activeClassType(ctx, q, in.ClassTypeID)
	if err != nil {
		return "", err
	}
	if in.ValidFrom == "" {
		zone, err := localtime.BranchZone(ctx, q, in.BranchID)
		if err != nil {
			return "", err
		}
		in.ValidFrom = localtime.DayKey(s.now(), zone)
	}
	t := SessionTemplate{
		ClassTypeID: in.ClassTypeID, CoachID: in.CoachID, BranchID: in.BranchID, Area: in.Area,
		Weekday: in.Weekday, StartTime: in.StartTime,
		DurationMin: orDefault(in.DurationMin, def.DurationMin),
		Capacity:    orDefault(in.Capacity, def.Capacity),
		CreditCost:  orDefault(in.CreditCost, def.CreditCost),
		ValidFrom:   in.ValidFrom, ValidUntil: in.ValidUntil, Active: in.Active, SkipHolidays: in.SkipHolidays,
		CreatedBy: createdBy,
	}
	if err := validRange(t); err != nil {
		return "", err
	}
	return s.repo.InsertTemplate(ctx, q, t)
}

func (s *Service) UpdateTemplate(ctx context.Context, id string, p TemplatePatch) error {
	return s.inTx(ctx, func(q Q) error { return s.updateTemplate(ctx, q, id, p) })
}

// updateTemplate is UpdateTemplate on q, for callers in a transaction.
func (s *Service) updateTemplate(ctx context.Context, q Q, id string, p TemplatePatch) error {
	t, err := s.repo.GetTemplate(ctx, q, id)
	if err != nil {
		return err
	}
	if t == nil {
		return errTemplateNotFound
	}
	if p.ClassTypeID != nil && *p.ClassTypeID != t.ClassTypeID {
		if _, err := s.activeClassType(ctx, q, *p.ClassTypeID); err != nil {
			return err
		}
		t.ClassTypeID = *p.ClassTypeID
	}
	t.CoachID, t.BranchID, t.Area = pick(p.CoachID, t.CoachID), pick(p.BranchID, t.BranchID), pick(p.Area, t.Area)
	t.ValidUntil = pick(p.ValidUntil, t.ValidUntil)
	set(&t.Weekday, p.Weekday)
	set(&t.StartTime, p.StartTime)
	set(&t.DurationMin, p.DurationMin)
	set(&t.Capacity, p.Capacity)
	set(&t.CreditCost, p.CreditCost)
	set(&t.ValidFrom, p.ValidFrom)
	set(&t.Active, p.Active)
	set(&t.SkipHolidays, p.SkipHolidays)
	if err := validRange(*t); err != nil {
		return err
	}
	return s.repo.UpdateTemplate(ctx, q, *t)
}

func set[T any](dst *T, v *T) {
	if v != nil {
		*dst = *v
	}
}

func validRange(t SessionTemplate) error {
	if t.ValidUntil != nil && *t.ValidUntil < t.ValidFrom {
		return schedulingError("Tanggal akhir template tidak boleh sebelum tanggal mulai", 400)
	}
	return nil
}

func (s *Service) activeClassType(ctx context.Context, q Q, id string) (*ClassTypeDefaults, error) {
	def, err := s.repo.ClassTypeDefaults(ctx, q, id)
	if err == nil && (def == nil || def.Status != "active") {
		err = errClassTypeGone
	}
	return def, err
}

// DeleteTemplate removes the template; sessions it generated stay on the
// schedule without the link.
func (s *Service) DeleteTemplate(ctx context.Context, id string) error {
	found, err := s.repo.DeleteTemplate(ctx, s.db, id)
	if err == nil && !found {
		err = errTemplateNotFound
	}
	return err
}

// GenerateResult is {created, skipped, conflicts, holidays}: skipped
// occurrences clash with a busy coach or room, or their slot already holds
// the class; holidays are the dates left out because they are public
// holidays, with how many sessions each would have had.
type GenerateResult struct {
	Created   int           `json:"created"`
	Skipped   int           `json:"skipped"`
	Conflicts []string      `json:"conflicts"`
	Holidays  []HolidaySkip `json:"holidays"`
}

// HolidaySkip is a holiday date generation left out.
type HolidaySkip struct {
	Date     string `json:"date"`
	Name     string `json:"name"`
	Sessions int    `json:"sessions"`
}

// holidayLookahead bounds the holidays read per run: past the longest
// horizon (the 90-day rule maximum) with room for branch zones.
const holidayLookahead = 92

// holidaysFrom maps the public holiday dates from the Jakarta day of now
// (a branch day is never earlier) up to the lookahead to their names; none
// without a calendar.
func (s *Service) holidaysFrom(ctx context.Context, q Q, now time.Time) (map[string]string, error) {
	if s.Holidays == nil {
		return map[string]string{}, nil
	}
	from := now.In(localtime.Jakarta)
	return s.Holidays.Holidays(ctx, q, localtime.DayKey(from, localtime.Jakarta),
		localtime.DayKey(from.AddDate(0, 0, holidayLookahead), localtime.Jakarta))
}

func (r *GenerateResult) skipHoliday(date, name string) {
	for i := range r.Holidays {
		if r.Holidays[i].Date == date {
			r.Holidays[i].Sessions++
			return
		}
	}
	r.Holidays = append(r.Holidays, HolidaySkip{Date: date, Name: name, Sessions: 1})
}

// GenerateFromTemplates creates the published sessions active templates
// produce from now until horizonDays ahead and returns how many it created.
// horizonDays <= 0 uses each branch's scheduleHorizonDays rule. Idempotent:
// a template date already generated is never generated again, even after
// its session was cancelled or deleted. Meant for a periodic job.
func (s *Service) GenerateFromTemplates(ctx context.Context, now time.Time, horizonDays int) (int, error) {
	out, err := s.generateFromTemplates(ctx, now, horizonDays)
	return out.Created, err
}

func (s *Service) generateFromTemplates(ctx context.Context, now time.Time, horizonDays int) (GenerateResult, error) {
	out := GenerateResult{Conflicts: []string{}, Holidays: []HolidaySkip{}}
	err := s.inTx(ctx, func(q Q) error {
		if err := s.repo.LockSchedule(ctx, q); err != nil {
			return err
		}
		holidays, err := s.holidaysFrom(ctx, q, now)
		if err != nil {
			return err
		}
		// Jakarta is the westernmost zone: its date is never later than a
		// branch's, so this keeps every template still valid somewhere.
		templates, err := s.repo.ActiveTemplates(ctx, q, localtime.DayKey(now, localtime.Jakarta))
		if err != nil {
			return err
		}
		rulesFor := s.branchRules(q)
		for _, t := range templates {
			rules, err := rulesFor(ctx, t.BranchID)
			if err != nil {
				return err
			}
			horizon := horizonDays
			if horizon <= 0 {
				horizon = rules.ScheduleHorizonDays
			}
			done, err := s.repo.GeneratedDates(ctx, q, t.ID)
			if err != nil {
				return err
			}
			for _, occ := range domain.TemplateOccurrences(t.weeklySlot(), now, horizon) {
				if done[occ.Date] {
					continue
				}
				if name, closed := holidays[occ.Date]; closed && t.SkipHolidays {
					out.skipHoliday(occ.Date, name)
					continue
				}
				created, err := s.generateOccurrence(ctx, q, t, occ, rules, &out)
				if err != nil {
					return err
				}
				if created {
					out.Created++
				} else {
					out.Skipped++
				}
			}
		}
		return nil
	})
	return out, err
}

// generateOccurrence creates one dated session and records the date as
// generated. A clash or a taken slot is reported and left for a later run.
func (s *Service) generateOccurrence(ctx context.Context, q Q, t SessionTemplate, occ domain.Occurrence, rules domain.Rules, out *GenerateResult) (bool, error) {
	clash, err := s.findConflict(ctx, q, domain.Slot{
		CoachID: t.CoachID, BranchID: t.BranchID, Area: t.Area, StartsAt: occ.StartsAt, EndsAt: occ.EndsAt,
	})
	if err != nil {
		return false, err
	}
	label := t.ClassTypeName + " " + localtime.Format(occ.StartsAt, t.Zone) + ": "
	if clash != nil {
		out.Conflicts = append(out.Conflicts, label+clash.Message())
		return false, nil
	}
	opens, closes := domain.DeriveBookingWindow(occ.StartsAt, rules)
	id, err := s.repo.InsertSessionIfFree(ctx, q, NewSession{
		ClassTypeID: t.ClassTypeID, CoachID: t.CoachID, BranchID: t.BranchID, Area: t.Area,
		StartsAt: occ.StartsAt, Capacity: t.Capacity, CreditCost: t.CreditCost,
		BookingOpensAt: opens, BookingClosesAt: closes, Status: domain.SessionPublished,
		TemplateID: &t.ID, OccurrenceDate: &occ.Date,
	}, occ.EndsAt)
	if err != nil {
		return false, err
	}
	if id == "" {
		out.Conflicts = append(out.Conflicts, label+"kelas ini sudah ada di jadwal")
		return false, nil
	}
	return true, s.repo.RecordOccurrence(ctx, q, t.ID, occ.Date, id)
}
