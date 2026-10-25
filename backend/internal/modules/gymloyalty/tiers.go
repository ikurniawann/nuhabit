package gymloyalty

import (
	"context"
	"math"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/gymloyalty/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// The tier editor and the loyalty settings (Gym → Membership & Progres).

// Actor is the staff member behind a write, for the audit trail.
type Actor struct {
	ID   string
	Name *string
	// Entry carries the request's IP and user agent.
	Entry audit.Entry
}

func (a Actor) audit(ctx context.Context, q database.Querier, action, entity, id string, before, after any, reason *string) error {
	e := a.Entry
	e.ActorID, e.ActorName, e.Action, e.Entity, e.EntityID = a.ID, a.Name, action, entity, &id
	e.Before, e.After, e.Reason = before, after, reason
	return audit.Write(ctx, q, e)
}

// TierRow is a ladder rung with the members holding it.
type TierRow struct {
	domain.Tier
	Rank    int `json:"rank"`
	Members int `json:"members"`
}

// TiersView is the editor: the ladder and the settings.
type TiersView struct {
	Tiers    []TierRow       `json:"tiers"`
	Settings domain.Settings `json:"settings"`
	OffPeak  []BranchOffPeak `json:"offpeak"`
}

// Tiers lists the ladder lowest first, with the loyalty settings.
func (s *Service) Tiers(ctx context.Context) (TiersView, error) {
	tiers, err := activeTiers(ctx, s.db)
	if err != nil {
		return TiersView{}, err
	}
	counts, err := tierCounts(ctx, s.db)
	if err != nil {
		return TiersView{}, err
	}
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return TiersView{}, err
	}
	offpeak, err := offPeakHours(ctx, s.db)
	if err != nil {
		return TiersView{}, err
	}
	view := TiersView{Tiers: make([]TierRow, len(tiers)), Settings: settings, OffPeak: offpeak}
	for i, t := range tiers {
		view.Tiers[i] = TierRow{Tier: t, Rank: i + 1, Members: counts[t.ID]}
	}
	return view, nil
}

// TierInput is the tier editor's body.
type TierInput struct {
	Name              string   `json:"name"`
	Color             *string  `json:"color"`
	MinSpend          float64  `json:"min_spend_idr"`
	DiscountPercent   float64  `json:"discount_percent"`
	EarlyBookingDays  int      `json:"early_booking_days"`
	CancelWindowHours *int     `json:"cancel_window_hours"`
	WaitlistPriority  bool     `json:"waitlist_priority"`
	Perks             []string `json:"perks"`
}

var hexColor = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (in TierInput) validate() (tierWrite, error) {
	name := strings.Join(strings.Fields(in.Name), " ")
	perks := domain.CleanPerks(in.Perks)
	bad := func(msg string) (tierWrite, error) { return tierWrite{}, httpx.BadRequest(msg) }
	switch {
	case name == "" || len([]rune(name)) > 40:
		return bad("Nama tier wajib diisi, maksimal 40 karakter")
	case in.Color != nil && *in.Color != "" && !hexColor.MatchString(*in.Color):
		return bad("Warna harus berformat #RRGGBB")
	case in.MinSpend < 0 || in.MinSpend > 1e12:
		return bad("Ambang belanja tidak valid")
	case in.DiscountPercent < 0 || in.DiscountPercent > 100:
		return bad("Diskon harus 0 sampai 100 persen")
	case in.EarlyBookingDays < 0 || in.EarlyBookingDays > 14:
		return bad("Booking lebih awal 0 sampai 14 hari")
	case in.CancelWindowHours != nil && (*in.CancelWindowHours < 0 || *in.CancelWindowHours > 72):
		return bad("Batas batal 0 sampai 72 jam")
	case len(perks) > 20:
		return bad("Maksimal 20 perks")
	}
	for _, p := range perks {
		if len([]rune(p)) > 80 {
			return bad("Satu perk maksimal 80 karakter")
		}
	}
	color := in.Color
	if color != nil && *color == "" {
		color = nil
	}
	return tierWrite{
		Name: name, Color: color, MinSpend: math.Round(in.MinSpend), DiscountPercent: math.Round(in.DiscountPercent*100) / 100,
		EarlyBookingDays: in.EarlyBookingDays, CancelWindowHours: in.CancelWindowHours, WaitlistPriority: in.WaitlistPriority, Perks: perks,
	}, nil
}

var errTierTaken = httpx.Conflict("Nama atau ambang belanja sudah dipakai tier lain")
var errTierNotFound = httpx.NotFound("Tier tidak ditemukan")

// SaveTier creates a tier (id "") or updates one. Members move to the new
// ladder at the next evaluation; the editor runs RecomputeAll after saving.
func (s *Service) SaveTier(ctx context.Context, id string, in TierInput, actor Actor) (*domain.Tier, error) {
	w, err := in.validate()
	if err != nil {
		return nil, err
	}
	var out *domain.Tier
	err = s.inTx(ctx, func(q database.DB) error {
		var before *domain.Tier
		if id == "" {
			if id, err = insertTier(ctx, q, w, actor.ID); err != nil {
				return err
			}
		} else {
			if before, err = tierByID(ctx, q, id); err != nil {
				return err
			}
			if before == nil {
				return errTierNotFound
			}
			if err := updateTier(ctx, q, id, w, actor.ID); err != nil {
				return err
			}
		}
		if out, err = tierByID(ctx, q, id); err != nil {
			return err
		}
		action := "update"
		if before == nil {
			action = "create"
		}
		return actor.audit(ctx, q, action, "gym_membership_tier", id, before, out, nil)
	})
	if database.IsUniqueViolation(err) {
		return nil, errTierTaken
	}
	return out, err
}

// DeleteTier takes a tier off the ladder. Its members drop to the tier
// their spending earns at the next evaluation.
func (s *Service) DeleteTier(ctx context.Context, id string, actor Actor) error {
	return s.inTx(ctx, func(q database.DB) error {
		before, err := tierByID(ctx, q, id)
		if err != nil {
			return err
		}
		if before == nil {
			return errTierNotFound
		}
		if err := retireTier(ctx, q, id, actor.ID); err != nil {
			return err
		}
		return actor.audit(ctx, q, "delete", "gym_membership_tier", id, before, nil, nil)
	})
}

// SettingsInput is the settings form: the loyalty settings and the
// off-peak window of each branch listed (nil window clears it).
type SettingsInput struct {
	domain.Settings
	OffPeak []struct {
		BranchID string          `json:"branch_id"`
		Window   *domain.OffPeak `json:"offpeak"`
	} `json:"offpeak"`
}

func (in SettingsInput) validate() error {
	s := in.Settings
	inRange := func(v, lo, hi int) bool { return v >= lo && v <= hi }
	for _, xp := range []int{s.XPClassAttended, s.XPPTAttended, s.XPOffPeakBonus, s.XPWeeklyStreak, s.XPStreak4W, s.XPEarlyRenewal} {
		if !inRange(xp, 0, 10000) {
			return httpx.BadRequest("Nilai XP 0 sampai 10.000")
		}
	}
	switch {
	case !inRange(s.TierHoldMonths, 0, 36):
		return httpx.BadRequest("Masa tahan tier 0 sampai 36 bulan")
	case !inRange(s.WeeklyStreakMinSessions, 1, 14):
		return httpx.BadRequest("Sesi minimum streak 1 sampai 14 per minggu")
	case !inRange(s.XPPurchasePerStep, 0, 1000):
		return httpx.BadRequest("XP pembelian 0 sampai 1.000 per kelipatan")
	case !inRange(s.PurchaseStepIdr, 1000, 10_000_000):
		return httpx.BadRequest("Kelipatan pembelian Rp 1.000 sampai Rp 10.000.000")
	}
	for _, o := range in.OffPeak {
		if w := o.Window; w != nil && (!inRange(w.Start, 0, 1439) || !inRange(w.End, 1, 1440) || w.End <= w.Start) {
			return httpx.BadRequest("Jam sepi tidak valid: jam selesai harus setelah jam mulai")
		}
	}
	return nil
}

// SaveSettings stores the settings and off-peak hours.
func (s *Service) SaveSettings(ctx context.Context, in SettingsInput, actor Actor) (TiersView, error) {
	if err := in.validate(); err != nil {
		return TiersView{}, err
	}
	err := s.inTx(ctx, func(q database.DB) error {
		before, err := loadSettings(ctx, q)
		if err != nil {
			return err
		}
		if err := saveSettings(ctx, q, in.Settings, actor.ID); err != nil {
			return err
		}
		for _, o := range in.OffPeak {
			if err := setOffPeak(ctx, q, o.BranchID, o.Window); err != nil {
				if database.PgCode(err) == "23503" || database.PgCode(err) == "22P02" {
					return httpx.BadRequest("Cabang tidak ditemukan")
				}
				return err
			}
		}
		return actor.audit(ctx, q, "update", "gym_loyalty_settings", "global", before, in, nil)
	})
	if err != nil {
		return TiersView{}, err
	}
	return s.Tiers(ctx)
}
