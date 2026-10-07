package resort

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/resort/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Room types and rooms per branch (lib/resort/catalog-server.ts and the
// shared loaders of lib/resort/server.ts).

// loadRoomTypes is loadRoomTypes.
func loadRoomTypes(ctx context.Context, q database.Querier, branchID string, onlyActive bool) ([]domain.RoomType, error) {
	active := ""
	if onlyActive {
		active = "AND t.is_active"
	}
	rows, err := q.Query(ctx, `SELECT t.id::text, t.code, t.name, t.description, t.zone, t.capacity_adults, t.capacity_children,
	        t.extra_bed_capacity, t.rate_weekday::float8 AS rate_weekday, t.rate_weekend::float8 AS rate_weekend,
	        t.extra_bed_rate::float8 AS extra_bed_rate, t.amenities, t.is_active, t.sort_order,
	        (SELECT COUNT(*) FROM resort.rooms r WHERE r.room_type_id = t.id AND r.is_active)::int AS room_count
	 FROM resort.room_types t
	 WHERE t.branch_id = $1 `+active+`
	 ORDER BY t.sort_order, t.name`, branchID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.RoomType])
}

// loadSeasons is loadSeasons; from and to narrow it to seasons touching
// the range when both are set.
func loadSeasons(ctx context.Context, q database.Querier, branchID, from, to string) ([]domain.RateSeason, error) {
	args := []any{branchID}
	rng := ""
	if from != "" && to != "" {
		args = append(args, from, to)
		rng = ` AND start_date <= $3 AND end_date >= $2`
	}
	rows, err := q.Query(ctx, `SELECT room_type_id::text, label, start_date::text AS start_date, end_date::text AS end_date,
	        rate::float8 AS rate, surcharge_percent::float8 AS surcharge_percent
	 FROM resort.rate_dates WHERE branch_id = $1 AND is_active`+rng+`
	 ORDER BY start_date`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.RateSeason])
}

// RoomTypesWithSeasons is listRoomTypesWithSeasons.
func (s *Service) RoomTypesWithSeasons(ctx context.Context, branchID string, includeInactive bool) (any, error) {
	types, err := loadRoomTypes(ctx, s.db, branchID, !includeInactive)
	if err != nil {
		return nil, err
	}
	seasons, err := loadSeasons(ctx, s.db, branchID, "", "")
	if err != nil {
		return nil, err
	}
	return struct {
		Types   []domain.RoomType   `json:"types"`
		Seasons []domain.RateSeason `json:"seasons"`
	}{types, seasons}, nil
}

// RoomTypeInput is roomTypeCreateSchema after parsing.
type RoomTypeInput struct {
	Code, Name                                         string
	Description, Zone                                  *string
	CapacityAdults, CapacityChildren, ExtraBedCapacity int
	RateWeekday, RateWeekend, ExtraBedRate             float64
	Amenities                                          []string
	SortOrder                                          int
}

// exists reports whether sql finds a row.
func exists(ctx context.Context, q database.Querier, sql string, args ...any) (bool, error) {
	row, err := queryRow(ctx, q, sql, args...)
	return row != nil, err
}

// CreateRoomType is createRoomType.
func (s *Service) CreateRoomType(ctx context.Context, v Venue, in RoomTypeInput) (*Row, error) {
	taken, err := exists(ctx, s.db, `SELECT id FROM resort.room_types WHERE branch_id = $1 AND upper(code) = upper($2)`, v.BranchID, in.Code)
	if err != nil {
		return nil, err
	}
	if taken {
		return nil, httpx.Conflict(fmt.Sprintf(`Kode tipe kamar "%s" sudah dipakai`, in.Code))
	}
	return queryRow(ctx, s.db, `INSERT INTO resort.room_types
	   (company_id, branch_id, code, name, description, zone, capacity_adults, capacity_children,
	    extra_bed_capacity, rate_weekday, rate_weekend, extra_bed_rate, amenities, sort_order, created_by)
	 VALUES ($1, $2, upper($3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
	 RETURNING id, code, name`,
		v.CompanyID, v.BranchID, in.Code, in.Name, in.Description, in.Zone, in.CapacityAdults, in.CapacityChildren,
		in.ExtraBedCapacity, in.RateWeekday, in.RateWeekend, in.ExtraBedRate, in.Amenities, in.SortOrder, v.UserID)
}

// UpdateRoomType is updateRoomType: nil when the patch is empty.
func (s *Service) UpdateRoomType(ctx context.Context, branchID, id string, p *patch) (*Row, error) {
	found, err := exists(ctx, s.db, `SELECT id FROM resort.room_types WHERE id = $1 AND branch_id = $2`, id, branchID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, httpx.NotFound("Tipe kamar tidak ditemukan")
	}
	if p.empty() {
		return nil, nil
	}
	return queryRow(ctx, s.db, `UPDATE resort.room_types SET `+p.set(1)+`, updated_at = now() WHERE id = $1 RETURNING id, code, name`,
		append([]any{id}, p.vals...)...)
}

// remove is removeRoomType / removeRoom: delete the row, or only deactivate
// it when a reservation already used it. It returns the client message.
func (s *Service) remove(ctx context.Context, branchID, id string, k removal) (string, error) {
	current, err := queryRow(ctx, s.db, `SELECT id, name FROM resort.`+k.table+` WHERE id = $1 AND branch_id = $2`, id, branchID)
	if err != nil {
		return "", err
	}
	if current == nil {
		return "", httpx.NotFound(k.notFound)
	}
	var used string
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE `+k.usedBy+` = $1`, id).Scan(&used); err != nil {
		return "", err
	}
	name := current.Str("name")
	if used != "0" {
		if _, err := s.db.Exec(ctx, `UPDATE resort.`+k.table+` SET `+k.deactivate+`, updated_at = now() WHERE id = $1`, id); err != nil {
			return "", err
		}
		return fmt.Sprintf(k.deactivated, name), nil
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM resort.`+k.table+` WHERE id = $1`, id); err != nil {
		return "", err
	}
	return fmt.Sprintf(k.deleted, name), nil
}

type removal struct {
	table, usedBy, deactivate, notFound, deactivated, deleted string
}

var (
	roomTypeRemoval = removal{table: "room_types", usedBy: "room_type_id", deactivate: "is_active = false",
		notFound: "Tipe kamar tidak ditemukan", deactivated: "Tipe kamar %s dinonaktifkan (sudah dipakai reservasi, riwayat dipertahankan)",
		deleted: "Tipe kamar %s dihapus"}
	roomRemoval = removal{table: "rooms", usedBy: "room_id", deactivate: "is_active = false, status = 'ditutup'",
		notFound: "Kamar tidak ditemukan", deactivated: "Kamar %s dinonaktifkan (punya riwayat menginap)",
		deleted: "Kamar %s dihapus"}
)

// RemoveRoomType is removeRoomType.
func (s *Service) RemoveRoomType(ctx context.Context, branchID, id string) (string, error) {
	return s.remove(ctx, branchID, id, roomTypeRemoval)
}

// RemoveRoom is removeRoom.
func (s *Service) RemoveRoom(ctx context.Context, branchID, id string) (string, error) {
	return s.remove(ctx, branchID, id, roomRemoval)
}

// ListRooms is listRooms: rooms with housekeeping status and the guest
// checked in, if any.
func (s *Service) ListRooms(ctx context.Context, branchID, roomTypeID string) ([]*Row, error) {
	args := []any{branchID}
	filter := ""
	if roomTypeID != "" {
		args = append(args, roomTypeID)
		filter = " AND r.room_type_id = $2"
	}
	return queryRows(ctx, s.db, `SELECT r.id, r.code, r.name, r.zone, r.status, r.notes, r.is_active,
	        r.room_type_id, t.name AS room_type_name, t.code AS room_type_code,
	        stay.reservation_id, stay.guest_name, stay.check_out::text AS occupied_until
	 FROM resort.rooms r
	 JOIN resort.room_types t ON t.id = r.room_type_id
	 LEFT JOIN LATERAL (
	   SELECT res.id AS reservation_id, res.guest_name, res.check_out
	   FROM resort.reservation_rooms rr
	   JOIN resort.reservations res ON res.id = rr.reservation_id
	   WHERE rr.room_id = r.id AND res.status = 'check-in'
	   ORDER BY res.check_in DESC LIMIT 1
	 ) stay ON true
	 WHERE r.branch_id = $1`+filter+`
	 ORDER BY t.sort_order, t.name, r.code`, args...)
}

// RoomInput is roomCreateSchema after parsing.
type RoomInput struct {
	RoomTypeID, Code, Name string
	Zone, Notes            *string
}

// CreateRoom is createRoom.
func (s *Service) CreateRoom(ctx context.Context, v Venue, in RoomInput) (*Row, error) {
	found, err := exists(ctx, s.db, `SELECT id FROM resort.room_types WHERE id = $1 AND branch_id = $2`, in.RoomTypeID, v.BranchID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, httpx.NotFound("Tipe kamar tidak ditemukan")
	}
	taken, err := exists(ctx, s.db, `SELECT id FROM resort.rooms WHERE branch_id = $1 AND upper(code) = upper($2)`, v.BranchID, in.Code)
	if err != nil {
		return nil, err
	}
	if taken {
		return nil, httpx.Conflict(fmt.Sprintf(`Kode kamar "%s" sudah dipakai`, in.Code))
	}
	return queryRow(ctx, s.db, `INSERT INTO resort.rooms (company_id, branch_id, room_type_id, code, name, zone, notes, created_by)
	 VALUES ($1, $2, $3, upper($4), $5, $6, $7, $8) RETURNING id, code, name`,
		v.CompanyID, v.BranchID, in.RoomTypeID, in.Code, in.Name, in.Zone, in.Notes, v.UserID)
}

// UpdateRoom is updateRoom: nil when the patch is empty.
func (s *Service) UpdateRoom(ctx context.Context, branchID, id string, p *patch) (*Row, error) {
	found, err := exists(ctx, s.db, `SELECT id FROM resort.rooms WHERE id = $1 AND branch_id = $2`, id, branchID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, httpx.NotFound("Kamar tidak ditemukan")
	}
	if p.empty() {
		return nil, nil
	}
	return queryRow(ctx, s.db, `UPDATE resort.rooms SET `+p.set(1)+`, updated_at = now() WHERE id = $1 RETURNING id, code, name, status`,
		append([]any{id}, p.vals...)...)
}
