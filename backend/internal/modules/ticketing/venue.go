package ticketing

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Venue configuration for Pengaturan Tiket (venue-config-server.ts):
// settings, sales channels, time slot templates, daily capacity overrides
// and categories (categories-server.ts).

const settingsColumns = `id, re_entry_policy, default_credit_limit,
	default_payment_mode, booking_slug, booking_forfeit_days, daily_capacity,
	slot_grace_minutes, updated_at`

// defaultChannelsSQL is DEFAULT_CHANNELS_SQL ($1 company, $2 branch, $3 user).
const defaultChannelsSQL = `INSERT INTO ticketing.ticket_channels
	(company_id, branch_id, code, name, is_online, sort_order, created_by)
	VALUES
	  ($1, $2, 'walk-in', 'Walk-in (Loket)', false, 10, $3),
	  ($1, $2, 'website', 'Website Booking', true, 20, $3)
	ON CONFLICT (branch_id, code) DO NOTHING`

// Settings is getVenueSettings: bootstraps the settings row and the
// default channels on first visit (idempotent).
func (s *Service) Settings(ctx context.Context, v Venue) (*Row, error) {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_settings (company_id, branch_id, updated_by)
			VALUES ($1, $2, $3) ON CONFLICT (branch_id) DO NOTHING`, v.CompanyID, v.BranchID, v.UserID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, defaultChannelsSQL, v.CompanyID, v.BranchID, v.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return queryRow(ctx, s.db, `SELECT `+settingsColumns+` FROM ticketing.ticket_settings
		WHERE branch_id = $1 AND company_id = $2`, v.BranchID, v.CompanyID)
}

// UpdateSettings is updateVenueSettings; p's values come from the parser.
func (s *Service) UpdateSettings(ctx context.Context, v Venue, p *patch) (*Row, error) {
	row, err := queryRow(ctx, s.db, `UPDATE ticketing.ticket_settings SET `+p.sql()+`
		WHERE branch_id = $1 AND company_id = $2
		RETURNING `+settingsColumns, append([]any{v.BranchID, v.CompanyID, v.UserID}, p.values...)...)
	if err != nil {
		return nil, onDuplicate(err, "Slug booking sudah dipakai venue lain")
	}
	if row == nil {
		return nil, httpx.NotFound("Pengaturan belum dibootstrap — buka halaman Ticketing dulu")
	}
	return row, nil
}

const channelColumns = `id, code, name, is_online, sort_order, is_active, created_at, updated_at`

// ListChannels is listChannels.
func (s *Service) ListChannels(ctx context.Context, v Venue) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT `+channelColumns+` FROM ticketing.ticket_channels
		WHERE branch_id = $1 AND company_id = $2
		ORDER BY sort_order, name`, v.BranchID, v.CompanyID)
}

// UpdateChannel is updateChannel.
func (s *Service) UpdateChannel(ctx context.Context, v Venue, id string, p *patch) (*Row, error) {
	row, err := queryRow(ctx, s.db, `UPDATE ticketing.ticket_channels SET `+p.sql()+`
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		RETURNING `+channelColumns, append([]any{id, v.BranchID, v.CompanyID}, p.values...)...)
	if err == nil && row == nil {
		err = httpx.NotFound("Kanal tidak ditemukan")
	}
	return row, err
}

const (
	slotColumns = `id, label, start_time::text AS start_time,
	end_time::text AS end_time, capacity, sort_order, is_active,
	created_at, updated_at`
	slotLabelTaken = "Label slot sudah dipakai — pilih label lain"
	slotNotFound   = "Slot waktu tidak ditemukan"
)

// ListTimeSlots is listTimeSlots.
func (s *Service) ListTimeSlots(ctx context.Context, v Venue) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT `+slotColumns+` FROM ticketing.ticket_time_slots
		WHERE branch_id = $1 AND company_id = $2
		ORDER BY sort_order, start_time`, v.BranchID, v.CompanyID)
}

// TimeSlotInput is createTimeSlotSchema after parsing.
type TimeSlotInput struct {
	Label, StartTime, EndTime string
	Capacity                  *int
	SortOrder                 int
}

// CreateTimeSlot is createTimeSlot.
func (s *Service) CreateTimeSlot(ctx context.Context, v Venue, in TimeSlotInput) (*Row, error) {
	row, err := queryRow(ctx, s.db, `INSERT INTO ticketing.ticket_time_slots
		(company_id, branch_id, label, start_time, end_time, capacity, sort_order, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+slotColumns, v.CompanyID, v.BranchID, in.Label, in.StartTime, in.EndTime, in.Capacity, in.SortOrder, v.UserID)
	return row, onDuplicate(err, slotLabelTaken)
}

// UpdateTimeSlot is updateTimeSlot: the window is checked on the final
// values (stored merged with the patch).
func (s *Service) UpdateTimeSlot(ctx context.Context, v Venue, id string, startTime, endTime *string, p *patch) (*Row, error) {
	current, err := queryRow(ctx, s.db, `SELECT `+slotColumns+` FROM ticketing.ticket_time_slots
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.BranchID, v.CompanyID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, httpx.NotFound(slotNotFound)
	}
	finalStart, finalEnd := clock(current.Str("start_time")), clock(current.Str("end_time"))
	if startTime != nil {
		finalStart = *startTime
	}
	if endTime != nil {
		finalEnd = *endTime
	}
	if finalEnd <= finalStart {
		return nil, httpx.BadRequest("Jam selesai harus setelah jam mulai")
	}
	row, err := queryRow(ctx, s.db, `UPDATE ticketing.ticket_time_slots SET `+p.sql()+`
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		RETURNING `+slotColumns, append([]any{id, v.BranchID, v.CompanyID}, p.values...)...)
	return row, onDuplicate(err, slotLabelTaken)
}

// deleteScoped deletes one venue row or fails with notFound.
func (s *Service) deleteScoped(ctx context.Context, v Venue, table, id, notFound string) error {
	tag, err := s.db.Exec(ctx, fmt.Sprintf(`DELETE FROM ticketing.%s WHERE id = $1 AND branch_id = $2 AND company_id = $3`, table),
		id, v.BranchID, v.CompanyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound(notFound)
	}
	return nil
}

// DeleteTimeSlot is deleteTimeSlot (bookings keep their snapshot; the FK
// sets slot_id NULL).
func (s *Service) DeleteTimeSlot(ctx context.Context, v Venue, id string) error {
	return s.deleteScoped(ctx, v, "ticket_time_slots", id, slotNotFound)
}

const (
	capacityDateColumns = `id, label, start_date::text AS start_date,
	end_date::text AS end_date, capacity, is_active, created_at, updated_at`
	capacityDateNotFound = "Override kapasitas tidak ditemukan"
	endBeforeStart       = "Tanggal akhir tidak boleh sebelum tanggal mulai"
)

// ListCapacityDates is listCapacityDates.
func (s *Service) ListCapacityDates(ctx context.Context, v Venue) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT `+capacityDateColumns+` FROM ticketing.ticket_capacity_dates
		WHERE branch_id = $1 AND company_id = $2
		ORDER BY start_date DESC, created_at DESC`, v.BranchID, v.CompanyID)
}

// CapacityDateInput is createCapacityDateSchema after parsing.
type CapacityDateInput struct {
	Label, StartDate, EndDate string
	Capacity                  int
}

// CreateCapacityDate is createCapacityDate.
func (s *Service) CreateCapacityDate(ctx context.Context, v Venue, in CapacityDateInput) (*Row, error) {
	return queryRow(ctx, s.db, `INSERT INTO ticketing.ticket_capacity_dates
		(company_id, branch_id, label, start_date, end_date, capacity, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+capacityDateColumns, v.CompanyID, v.BranchID, in.Label, in.StartDate, in.EndDate, in.Capacity, v.UserID)
}

// UpdateCapacityDate is updateCapacityDate: the range is checked on the
// final values.
func (s *Service) UpdateCapacityDate(ctx context.Context, v Venue, id string, startDate, endDate *string, p *patch) (*Row, error) {
	current, err := queryRow(ctx, s.db, `SELECT `+capacityDateColumns+` FROM ticketing.ticket_capacity_dates
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.BranchID, v.CompanyID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, httpx.NotFound(capacityDateNotFound)
	}
	finalStart, finalEnd := current.Str("start_date"), current.Str("end_date")
	if startDate != nil {
		finalStart = *startDate
	}
	if endDate != nil {
		finalEnd = *endDate
	}
	if finalEnd < finalStart {
		return nil, httpx.BadRequest(endBeforeStart)
	}
	return queryRow(ctx, s.db, `UPDATE ticketing.ticket_capacity_dates SET `+p.sql()+`
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		RETURNING `+capacityDateColumns, append([]any{id, v.BranchID, v.CompanyID}, p.values...)...)
}

// DeleteCapacityDate is deleteCapacityDate.
func (s *Service) DeleteCapacityDate(ctx context.Context, v Venue, id string) error {
	return s.deleteScoped(ctx, v, "ticket_capacity_dates", id, capacityDateNotFound)
}

// ListCategories is listCategories (autocomplete, max 20).
func (s *Service) ListCategories(ctx context.Context, v Venue, q string) ([]*Row, error) {
	where, args := "branch_id = $1 AND company_id = $2", []any{v.BranchID, v.CompanyID}
	if q != "" {
		args = append(args, "%"+q+"%")
		where += " AND name ILIKE $3"
	}
	return queryRows(ctx, s.db, `SELECT id, name FROM ticketing.ticket_categories
		WHERE `+where+` ORDER BY name LIMIT 20`, args...)
}

const upsertCategorySQL = `INSERT INTO ticketing.ticket_categories (company_id, branch_id, name, created_by)
	VALUES ($1, $2, $3, $4)
	ON CONFLICT (branch_id, lower(name)) DO UPDATE SET updated_at = now()
	RETURNING id, name`

// EnsureCategory is ensureCategory: an existing name (case-insensitive)
// returns its row with created=false.
func (s *Service) EnsureCategory(ctx context.Context, v Venue, name string) (*Row, bool, error) {
	existing, err := queryRow(ctx, s.db, `SELECT id, name FROM ticketing.ticket_categories
		WHERE branch_id = $1 AND company_id = $2 AND lower(name) = lower($3)`, v.BranchID, v.CompanyID, name)
	if err != nil || existing != nil {
		return existing, false, err
	}
	row, err := queryRow(ctx, s.db, upsertCategorySQL, v.CompanyID, v.BranchID, name, v.UserID)
	return row, true, err
}

// resolveProductCategory is resolveProductCategory: a client category id
// must belong to the venue; a new name is auto-added. set=false means
// "unchanged" (undefined in the PATCH).
func resolveProductCategory(ctx context.Context, q database.Querier, v Venue, idSet bool, id, name *string) (value *string, set bool, err error) {
	if id != nil && *id != "" {
		var owned bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_categories
			WHERE id = $1 AND branch_id = $2 AND company_id = $3)`, *id, v.BranchID, v.CompanyID).Scan(&owned); err != nil {
			return nil, false, err
		}
		if !owned {
			return nil, false, httpx.BadRequest("Kategori tidak dikenal")
		}
		return id, true, nil
	}
	if !idSet && name != nil && *name != "" {
		var created string
		if err := q.QueryRow(ctx, `WITH c AS (`+upsertCategorySQL+`) SELECT id::text FROM c`, v.CompanyID, v.BranchID, *name, v.UserID).Scan(&created); err != nil {
			return nil, false, err
		}
		return &created, true, nil
	}
	return nil, idSet, nil
}
