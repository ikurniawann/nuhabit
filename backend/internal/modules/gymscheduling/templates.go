package gymscheduling

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/httpx"
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
	ValidFrom               string
	ValidUntil              *string
	Active                  bool
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
		def, err := s.activeClassType(ctx, q, in.ClassTypeID)
		if err != nil {
			return err
		}
		t := SessionTemplate{
			ClassTypeID: in.ClassTypeID, CoachID: in.CoachID, BranchID: in.BranchID, Area: in.Area,
			Weekday: in.Weekday, StartTime: in.StartTime,
			DurationMin: orDefault(in.DurationMin, def.DurationMin),
			Capacity:    orDefault(in.Capacity, def.Capacity),
			CreditCost:  orDefault(in.CreditCost, def.CreditCost),
			ValidFrom:   in.ValidFrom, ValidUntil: in.ValidUntil, Active: in.Active, CreatedBy: createdBy,
		}
		if err := validRange(t); err != nil {
			return err
		}
		id, err = s.repo.InsertTemplate(ctx, q, t)
		return err
	})
	return id, err
}

func (s *Service) UpdateTemplate(ctx context.Context, id string, p TemplatePatch) error {
	return s.inTx(ctx, func(q Q) error {
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
		if err := validRange(*t); err != nil {
			return err
		}
		return s.repo.UpdateTemplate(ctx, q, *t)
	})
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

// GenerateResult is {created, skipped, conflicts}: skipped occurrences clash
// with a busy coach or room, or their slot already holds the class.
type GenerateResult struct {
	Created   int      `json:"created"`
	Skipped   int      `json:"skipped"`
	Conflicts []string `json:"conflicts"`
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
	out := GenerateResult{Conflicts: []string{}}
	err := s.inTx(ctx, func(q Q) error {
		if err := s.repo.LockSchedule(ctx, q); err != nil {
			return err
		}
		templates, err := s.repo.ActiveTemplates(ctx, q, now.In(domain.WIB).Format(time.DateOnly))
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
	if err != nil {
		return GenerateResult{Conflicts: []string{}}, err
	}
	return out, nil
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
	label := t.ClassTypeName + " " + domain.FormatWib(occ.StartsAt) + ": "
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

// GenerateNow backs the "Generate sekarang" button.
func (s *Service) GenerateNow(ctx context.Context, horizonDays int) (GenerateResult, error) {
	return s.generateFromTemplates(ctx, s.now(), horizonDays)
}
