package resort

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/resort/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Reservations: list, availability, creation (rate snapshot and opening
// folio), contact edits and detail (lib/resort/reservations-server.ts).

// ReservationFilters are the list query params.
type ReservationFilters struct {
	Status, From, To, Search string
}

// ListReservations is listReservations (at most 300, latest stay first).
func (s *Service) ListReservations(ctx context.Context, branchID string, f ReservationFilters) ([]*Row, error) {
	args := []any{branchID}
	where := "r.branch_id = $1"
	if f.Status != "" && f.Status != "all" {
		args = append(args, f.Status)
		where += fmt.Sprintf(" AND r.status = $%d", len(args))
	}
	if f.From != "" && f.To != "" {
		args = append(args, f.From, f.To)
		// Reservations that touch the date range.
		where += fmt.Sprintf(" AND r.check_in < $%d::date + 1 AND r.check_out > $%d::date", len(args), len(args)-1)
	}
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		n := len(args)
		where += fmt.Sprintf(" AND (r.guest_name ILIKE $%d OR r.guest_phone ILIKE $%d OR r.reservation_code ILIKE $%d)", n, n, n)
	}
	return queryRows(ctx, s.db, `SELECT r.id, r.reservation_code, r.guest_name, r.guest_phone, r.guest_email,
	        r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights, r.adults, r.children,
	        r.status, r.source, r.total::float8 AS total, r.notes, r.created_by_name, r.created_at,
	        r.checked_in_at, r.checked_out_at,
	        (SELECT COUNT(*) FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id)::int AS room_count,
	        (SELECT string_agg(DISTINCT rr.room_type_name, ', ') FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id) AS room_types,
	        COALESCE((SELECT SUM(CASE WHEN f.direction = 'debit' THEN f.amount ELSE -f.amount END)
	                  FROM resort.folio_charges f WHERE f.reservation_id = r.id), 0)::float8 AS balance
	 FROM resort.reservations r
	 WHERE `+where+`
	 ORDER BY r.check_in DESC, r.created_at DESC
	 LIMIT 300`, args...)
}

// loadBooked is loadBookedRooms: room lines of reservations that still
// hold stock and overlap the range.
func loadBooked(ctx context.Context, q database.Querier, branchID, from, to string, excludeID *string) ([]domain.Booked, error) {
	rows, err := q.Query(ctx, `SELECT rr.room_type_id::text, rr.room_id::text, r.check_in::text AS check_in, r.check_out::text AS check_out
	 FROM resort.reservation_rooms rr
	 JOIN resort.reservations r ON r.id = rr.reservation_id
	 WHERE r.branch_id = $1
	   AND r.status = ANY($2::text[])
	   AND r.check_in < $4::date AND r.check_out > $3::date
	   AND ($5::uuid IS NULL OR r.id <> $5::uuid)`, branchID, domain.BlockingStatuses, from, to, excludeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.Booked])
}

// loadUnitRooms lists the active rooms that are not closed.
func loadUnitRooms(ctx context.Context, q database.Querier, branchID string) ([]domain.UnitRoom, error) {
	rows, err := q.Query(ctx, `SELECT id::text, code, name, room_type_id::text, status FROM resort.rooms
	 WHERE branch_id = $1 AND is_active AND status <> 'ditutup' ORDER BY code`, branchID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.UnitRoom])
}

func assertStayDates(checkIn, checkOut string) error {
	if msg := domain.ValidateStayDates(checkIn, checkOut); msg != "" {
		return httpx.BadRequest(msg)
	}
	return nil
}

// Availability is loadAvailability.
func (s *Service) Availability(ctx context.Context, branchID, checkIn, checkOut string, excludeID *string) (any, error) {
	if err := assertStayDates(checkIn, checkOut); err != nil {
		return nil, err
	}
	types, err := loadRoomTypes(ctx, s.db, branchID, true)
	if err != nil {
		return nil, err
	}
	seasons, err := loadSeasons(ctx, s.db, branchID, checkIn, checkOut)
	if err != nil {
		return nil, err
	}
	booked, err := loadBooked(ctx, s.db, branchID, checkIn, checkOut, excludeID)
	if err != nil {
		return nil, err
	}
	rooms, err := loadUnitRooms(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	return struct {
		CheckIn  string                    `json:"check_in"`
		CheckOut string                    `json:"check_out"`
		Nights   int                       `json:"nights"`
		Types    []domain.TypeAvailability `json:"types"`
		Seasons  []domain.RateSeason       `json:"seasons"`
	}{checkIn, checkOut, domain.NightsBetween(checkIn, checkOut),
		domain.SummarizeAvailability(types, rooms, booked, seasons, checkIn, checkOut), seasons}, nil
}

// ReservationInput is reservationCreateSchema after parsing.
type ReservationInput struct {
	GuestName, GuestPhone string
	GuestEmail            *string
	CheckIn, CheckOut     string
	Adults, Children      int
	Source, Status        string
	DiscountAmount        float64
	Notes, SpecialRequest *string
	Rooms                 []domain.RoomRequest
}

// CreatedReservation is the create response data.
type CreatedReservation struct {
	ID              string  `json:"id"`
	ReservationCode string  `json:"reservation_code"`
	Nights          int     `json:"nights"`
	Total           float64 `json:"total"`
}

// CreateReservation is createReservation: stock check per type, nightly
// rate snapshot, room lines and the opening folio charges.
//
// The TS checks stock before its transaction without a lock. Here the
// check runs inside the transaction after lockBranchStock, so two
// creations for the last room cannot both pass; the stock guard trigger
// covers a Go creation racing a TS one.
func (s *Service) CreateReservation(ctx context.Context, v Venue, in ReservationInput) (*CreatedReservation, string, error) {
	if err := assertStayDates(in.CheckIn, in.CheckOut); err != nil {
		return nil, "", err
	}
	var out CreatedReservation
	var lines int
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := lockBranchStock(ctx, tx, v.BranchID); err != nil {
			return err
		}
		plan, err := s.plan(ctx, tx, v.BranchID, in)
		if err != nil {
			return err
		}
		lines = len(plan.Lines)
		id, code, err := insertReservation(ctx, tx, v, in, plan)
		if err != nil {
			return err
		}
		out = CreatedReservation{ID: id, ReservationCode: code, Nights: plan.Nights, Total: plan.Total}
		if err := insertRoomLines(ctx, tx, v, id, in.GuestName, plan.Lines); err != nil {
			return err
		}
		charge := func(chargeType, direction, description string, amount float64) error {
			_, err := tx.Exec(ctx, `INSERT INTO resort.folio_charges
			   (company_id, branch_id, reservation_id, charge_type, direction, description, amount, created_by, created_by_name)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
				v.CompanyID, v.BranchID, id, chargeType, direction, description, amount, v.UserID, v.ActorName)
			return err
		}
		if plan.RoomTotal > 0 {
			if err := charge("kamar", "debit", fmt.Sprintf("Kamar %d unit × %d malam", len(plan.Lines), plan.Nights), plan.RoomTotal); err != nil {
				return err
			}
		}
		if plan.ExtraTotal > 0 {
			if err := charge("extra-bed", "debit", fmt.Sprintf("Extra bed × %d malam", plan.Nights), plan.ExtraTotal); err != nil {
				return err
			}
		}
		if in.DiscountAmount > 0 {
			return charge("diskon", "kredit", "Diskon reservasi", in.DiscountAmount)
		}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return &out, domain.ReservationSummary(out.ReservationCode, in.GuestName, out.Nights, lines, out.Total), nil
}

// plan loads the stock picture on q and runs planReservation.
func (s *Service) plan(ctx context.Context, q database.Querier, branchID string, in ReservationInput) (*domain.Plan, error) {
	types, err := loadRoomTypes(ctx, q, branchID, true)
	if err != nil {
		return nil, err
	}
	seasons, err := loadSeasons(ctx, q, branchID, in.CheckIn, in.CheckOut)
	if err != nil {
		return nil, err
	}
	booked, err := loadBooked(ctx, q, branchID, in.CheckIn, in.CheckOut, nil)
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `SELECT room_type_id::text, COUNT(*)::int AS total FROM resort.rooms
	 WHERE branch_id = $1 AND is_active AND status <> 'ditutup' GROUP BY room_type_id`, branchID)
	if err != nil {
		return nil, err
	}
	units := map[string]int{}
	var typeID string
	var total int
	if _, err := pgx.ForEachRow(rows, []any{&typeID, &total}, func() error { units[typeID] = total; return nil }); err != nil {
		return nil, err
	}
	plan, err := domain.PlanReservation(in.Rooms, in.CheckIn, in.CheckOut, in.DiscountAmount, types, booked, units, seasons)
	return plan, refusal(err)
}

// insertReservation inserts the header with a fresh code, retrying a code
// collision (23505) up to five times; each attempt runs in a savepoint.
func insertReservation(ctx context.Context, tx pgx.Tx, v Venue, in ReservationInput, plan *domain.Plan) (id, code string, err error) {
	for range 5 {
		code = domain.GenerateReservationCode()
		token := make([]byte, 24)
		if _, err := rand.Read(token); err != nil {
			return "", "", err
		}
		err = database.WithTx(ctx, tx, func(sp pgx.Tx) error {
			return sp.QueryRow(ctx, `INSERT INTO resort.reservations
			   (company_id, branch_id, reservation_code, access_token, guest_name, guest_phone, guest_email,
			    check_in, check_out, nights, adults, children, status, source, room_total, extra_total,
			    discount_amount, total, notes, special_request, created_by, created_by_name)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
			 RETURNING id::text`,
				v.CompanyID, v.BranchID, code, hex.EncodeToString(token), in.GuestName, in.GuestPhone, in.GuestEmail,
				in.CheckIn, in.CheckOut, plan.Nights, in.Adults, in.Children, in.Status, in.Source, plan.RoomTotal, plan.ExtraTotal,
				in.DiscountAmount, plan.Total, in.Notes, in.SpecialRequest, v.UserID, v.ActorName).Scan(&id)
		})
		if err == nil {
			return id, code, nil
		}
		if !database.IsUniqueViolation(err) {
			return "", "", err
		}
	}
	return "", "", errors.New("Gagal membuat kode reservasi unik")
}

// insertRoomLines writes one reservation_rooms row per unit with its rate
// snapshot; a line without its own guest name takes the booker's.
func insertRoomLines(ctx context.Context, tx pgx.Tx, v Venue, reservationID, bookerName string, lines []domain.Line) error {
	for _, l := range lines {
		var roomName *string
		if l.RoomID != nil {
			name, err := queryRow(ctx, tx, `SELECT name FROM resort.rooms WHERE id = $1`, *l.RoomID)
			if err != nil {
				return err
			}
			if name != nil {
				n := name.Str("name")
				roomName = &n
			}
		}
		guest := bookerName
		if l.GuestName != nil {
			guest = *l.GuestName
		}
		breakdown, err := json.Marshal(l.Quote.Breakdown)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO resort.reservation_rooms
		   (company_id, branch_id, reservation_id, room_type_id, room_id, room_type_name, room_name,
		    nightly_rate, nights, extra_bed, subtotal, guest_name, rate_breakdown)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
			v.CompanyID, v.BranchID, reservationID, l.TypeID, l.RoomID, l.TypeName, roomName,
			l.NightlyAverage(), l.Quote.Nights, l.ExtraBed, l.Quote.Subtotal, guest, string(breakdown)); err != nil {
			return err
		}
	}
	return nil
}

// UpdateReservation is updateReservation: nil when the patch is empty.
func (s *Service) UpdateReservation(ctx context.Context, branchID, id string, p *patch) (*Row, error) {
	if p.empty() {
		return nil, nil
	}
	row, err := queryRow(ctx, s.db, `UPDATE resort.reservations SET `+p.set(2)+`, updated_at = now()
	 WHERE id = $1 AND branch_id = $2 RETURNING id, reservation_code`, append([]any{id, branchID}, p.vals...)...)
	if err == nil && row == nil {
		err = httpx.NotFound("Reservasi tidak ditemukan")
	}
	return row, err
}

// ReservationDetail is reservationDetail: the reservation row followed by
// rooms, folio and folio totals; nil when it is not in this branch.
func (s *Service) ReservationDetail(ctx context.Context, branchID, id string) (*Row, error) {
	res, err := queryRow(ctx, s.db, `SELECT r.*, r.check_in::text AS check_in, r.check_out::text AS check_out,
	        r.room_total::float8 AS room_total, r.extra_total::float8 AS extra_total,
	        r.discount_amount::float8 AS discount_amount, r.total::float8 AS total
	 FROM resort.reservations r WHERE r.branch_id = $1 AND r.id = $2`, branchID, id)
	if err != nil || res == nil {
		return nil, err
	}
	rooms, err := queryRows(ctx, s.db, `SELECT rr.id, rr.room_type_id, rr.room_id, rr.room_type_name, rr.room_name, rr.guest_name,
	        rr.nightly_rate::float8 AS nightly_rate, rr.nights, rr.extra_bed, rr.subtotal::float8 AS subtotal,
	        rr.rate_breakdown, rm.code AS room_code, rm.status AS room_status
	 FROM resort.reservation_rooms rr
	 LEFT JOIN resort.rooms rm ON rm.id = rr.room_id
	 WHERE rr.reservation_id = $1 ORDER BY rr.created_at`, id)
	if err != nil {
		return nil, err
	}
	folio, err := queryRows(ctx, s.db, `SELECT id, charge_type, direction, description, amount::float8 AS amount, payment_method,
	        created_by_name, created_at
	 FROM resort.folio_charges WHERE reservation_id = $1 ORDER BY created_at`, id)
	if err != nil {
		return nil, err
	}
	lines := make([]domain.FolioLine, len(folio))
	for i, f := range folio {
		amount, _ := f.vals["amount"].(float64)
		lines[i] = domain.FolioLine{Direction: f.Str("direction"), Amount: amount}
	}
	return res.Set("rooms", rooms).Set("folio", folio).Set("totals", domain.Totals(lines)), nil
}
