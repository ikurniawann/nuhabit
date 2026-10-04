package resort

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/resort/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Front office: the daily board, status transitions and folio lines
// (lib/resort/front-desk-server.ts).

const listColumns = `r.id, r.reservation_code, r.guest_name, r.guest_phone, r.status, r.source,
  r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights, r.adults, r.children,
  r.total::float8 AS total, r.special_request,
  (SELECT COUNT(*) FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id)::int AS room_count,
  (SELECT string_agg(COALESCE(rr.room_name, rr.room_type_name), ', ' ORDER BY rr.created_at)
     FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id) AS rooms_label,
  COALESCE((SELECT SUM(CASE WHEN f.direction = 'debit' THEN f.amount ELSE -f.amount END)
            FROM resort.folio_charges f WHERE f.reservation_id = r.id), 0)::float8 AS balance`

// FrontOfficeBoard is loadFrontOfficeBoard: arrivals, departures and
// in-house guests of one date, the rooms and the occupancy summary.
func (s *Service) FrontOfficeBoard(ctx context.Context, branchID, date string) (any, error) {
	arrivals, err := queryRows(ctx, s.db, `SELECT `+listColumns+` FROM resort.reservations r
	 WHERE r.branch_id = $1 AND r.check_in = $2::date
	   AND r.status IN ('menunggu-bayar', 'terkonfirmasi')
	 ORDER BY r.created_at`, branchID, date)
	if err != nil {
		return nil, err
	}
	departures, err := queryRows(ctx, s.db, `SELECT `+listColumns+` FROM resort.reservations r
	 WHERE r.branch_id = $1 AND r.check_out = $2::date AND r.status = 'check-in'
	 ORDER BY r.created_at`, branchID, date)
	if err != nil {
		return nil, err
	}
	inHouse, err := queryRows(ctx, s.db, `SELECT `+listColumns+` FROM resort.reservations r
	 WHERE r.branch_id = $1 AND r.status = 'check-in'
	 ORDER BY r.check_out, r.guest_name`, branchID)
	if err != nil {
		return nil, err
	}
	rooms, err := queryRows(ctx, s.db, `SELECT r.id, r.code, r.name, r.status, r.zone, t.name AS room_type_name,
	        stay.guest_name, stay.check_out::text AS occupied_until
	 FROM resort.rooms r
	 JOIN resort.room_types t ON t.id = r.room_type_id
	 LEFT JOIN LATERAL (
	   SELECT res.guest_name, res.check_out FROM resort.reservation_rooms rr
	   JOIN resort.reservations res ON res.id = rr.reservation_id
	   WHERE rr.room_id = r.id AND res.status = 'check-in' LIMIT 1
	 ) stay ON true
	 WHERE r.branch_id = $1 AND r.is_active
	 ORDER BY t.sort_order, t.name, r.code`, branchID)
	if err != nil {
		return nil, err
	}
	occupied := 0
	for _, r := range rooms {
		if r.Str("guest_name") != "" {
			occupied++
		}
	}
	return struct {
		Date       string           `json:"date"`
		Arrivals   []*Row           `json:"arrivals"`
		Departures []*Row           `json:"departures"`
		InHouse    []*Row           `json:"in_house"`
		Rooms      []*Row           `json:"rooms"`
		Summary    domain.Occupancy `json:"summary"`
	}{date, arrivals, departures, inHouse, rooms,
		domain.OccupancySummary(len(rooms), occupied, len(arrivals), len(departures))}, nil
}

// Assignment is one check-in room assignment.
type Assignment struct{ ReservationRoomID, RoomID string }

// StatusChange is statusChangeSchema after parsing.
type StatusChange struct {
	Action      string
	Assignments []Assignment
	Reason      *string
	Force       bool
}

// StatusChanged is the status response data.
type StatusChanged struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Code   string `json:"code"`
	Guest  string `json:"guest"`
}

// ChangeStatus is changeReservationStatus, in one transaction: check-in
// needs a room on every line, check-out refuses an open folio unless
// forced (the reason is noted) and marks the rooms dirty.
func (s *Service) ChangeStatus(ctx context.Context, v Venue, id string, in StatusChange) (*StatusChanged, string, error) {
	next := domain.StatusActions[in.Action]
	var out StatusChanged
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		res, err := queryRow(ctx, tx, `SELECT id, status, reservation_code, guest_name FROM resort.reservations
		 WHERE id = $1 AND branch_id = $2 FOR UPDATE`, id, v.BranchID)
		if err != nil {
			return err
		}
		if res == nil {
			return httpx.NotFound("Reservasi tidak ditemukan")
		}
		current := res.Str("status")
		if !domain.CanTransition(current, next) {
			return httpx.Conflict(domain.TransitionError(current, next))
		}
		switch next {
		case domain.StatusCheckedIn:
			if err := assignRooms(ctx, tx, v.BranchID, id, in.Assignments); err != nil {
				return err
			}
		case domain.StatusCheckedOut:
			if err := checkOut(ctx, tx, id, in.Force); err != nil {
				return err
			}
		case domain.StatusCancelled, domain.StatusNoShow:
			if _, err := tx.Exec(ctx, `UPDATE resort.reservations SET cancelled_at = now(), cancel_reason = $2 WHERE id = $1`, id, in.Reason); err != nil {
				return err
			}
		}
		stamp := map[string]string{
			domain.StatusCheckedIn:  ", checked_in_at = now()",
			domain.StatusCheckedOut: ", checked_out_at = now()",
			domain.StatusConfirmed:  ", paid_at = COALESCE(paid_at, now())",
		}[next]
		if _, err := tx.Exec(ctx, `UPDATE resort.reservations SET status = $2`+stamp+`, updated_at = now() WHERE id = $1`, id, next); err != nil {
			return err
		}
		if next == domain.StatusCheckedOut && in.Force && in.Reason != nil && *in.Reason != "" {
			// Check-out with an open balance: the reason becomes a note.
			if _, err := tx.Exec(ctx, `UPDATE resort.reservations
			 SET notes = COALESCE(notes || E'\n', '') || $2, updated_at = now() WHERE id = $1`,
				id, fmt.Sprintf("Check-out dengan saldo terbuka (%s): %s", v.ActorName, *in.Reason)); err != nil {
				return err
			}
		}
		out = StatusChanged{ID: id, Status: next, Code: res.Str("reservation_code"), Guest: res.Str("guest_name")}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return &out, fmt.Sprintf("%s — %s: %s", out.Code, out.Guest, domain.StatusLabels[out.Status]), nil
}

// assignRooms applies the check-in room assignments and requires every
// line to have a room. The branch stock lock (not taken by the TS)
// serializes the "room already occupied" check across Go check-ins.
func assignRooms(ctx context.Context, tx pgx.Tx, branchID, id string, assignments []Assignment) error {
	if err := lockBranchStock(ctx, tx, branchID); err != nil {
		return err
	}
	for _, a := range assignments {
		room, err := queryRow(ctx, tx, `SELECT id, name FROM resort.rooms WHERE id = $1 AND branch_id = $2 AND is_active AND status <> 'ditutup'`, a.RoomID, branchID)
		if err != nil {
			return err
		}
		if room == nil {
			return httpx.BadRequest("Kamar tujuan tidak tersedia")
		}
		busy, err := exists(ctx, tx, `SELECT 1 FROM resort.reservation_rooms rr JOIN resort.reservations r ON r.id = rr.reservation_id
		 WHERE rr.room_id = $1 AND r.status = 'check-in' AND r.id <> $2 LIMIT 1`, a.RoomID, id)
		if err != nil {
			return err
		}
		if busy {
			return httpx.Conflict(fmt.Sprintf("Kamar %s sedang ditempati tamu lain", room.Str("name")))
		}
		if _, err := tx.Exec(ctx, `UPDATE resort.reservation_rooms SET room_id = $2, room_name = $3
		 WHERE id = $1 AND reservation_id = $4`, a.ReservationRoomID, a.RoomID, room.Str("name"), id); err != nil {
			return err
		}
	}
	var unassigned string
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NULL`, id).Scan(&unassigned); err != nil {
		return err
	}
	if unassigned != "0" {
		return httpx.BadRequest("Tetapkan unit kamar untuk semua baris reservasi sebelum check-in")
	}
	return nil
}

// checkOut refuses a positive folio balance unless forced, then marks the
// reservation's rooms dirty for housekeeping.
func checkOut(ctx context.Context, tx pgx.Tx, id string, force bool) error {
	lines, err := folioLines(ctx, tx, id)
	if err != nil {
		return err
	}
	if balance := domain.Balance(lines); balance > 0 && !force {
		return httpx.Conflict(fmt.Sprintf("Folio masih bersaldo %s — lunasi dulu atau centang lanjutkan dengan catatan", domain.FormatRupiah(balance)))
	}
	_, err = tx.Exec(ctx, `UPDATE resort.rooms SET status = 'kotor', updated_at = now()
	 WHERE id IN (SELECT room_id FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NOT NULL)`, id)
	return err
}

// folioLines reads a reservation's folio directions and amounts.
func folioLines(ctx context.Context, q database.Querier, id string) ([]domain.FolioLine, error) {
	rows, err := q.Query(ctx, `SELECT direction, amount::float8 FROM resort.folio_charges WHERE reservation_id = $1`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.FolioLine])
}

// FolioChargeInput is folioChargeSchema after parsing.
type FolioChargeInput struct {
	ChargeType, Description string
	Amount                  float64
	PaymentMethod           *string
}

// AddFolioCharge is addFolioCharge: the direction follows the charge type.
func (s *Service) AddFolioCharge(ctx context.Context, v Venue, id string, in FolioChargeInput) (any, string, error) {
	res, err := queryRow(ctx, s.db, `SELECT id, status FROM resort.reservations WHERE id = $1 AND branch_id = $2`, id, v.BranchID)
	if err != nil {
		return nil, "", err
	}
	if res == nil {
		return nil, "", httpx.NotFound("Reservasi tidak ditemukan")
	}
	if res.Str("status") == domain.StatusCancelled {
		return nil, "", httpx.Conflict("Reservasi sudah dibatalkan")
	}
	direction := domain.ChargeDirection(in.ChargeType)
	charge, err := queryRow(ctx, s.db, `INSERT INTO resort.folio_charges
	   (company_id, branch_id, reservation_id, charge_type, direction, description, amount, payment_method, created_by, created_by_name)
	 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	 RETURNING id, charge_type, direction, description, amount::float8 AS amount, created_at`,
		v.CompanyID, v.BranchID, id, in.ChargeType, direction, in.Description, in.Amount, in.PaymentMethod, v.UserID, v.ActorName)
	if err != nil {
		return nil, "", err
	}
	lines, err := folioLines(ctx, s.db, id)
	if err != nil {
		return nil, "", err
	}
	totals := domain.Totals(lines)
	msg := fmt.Sprintf("Biaya %s ditambahkan — saldo %s", in.Description, domain.FormatRupiah(totals.Balance))
	if direction == "kredit" {
		msg = fmt.Sprintf("Pembayaran %s dicatat — sisa %s", domain.FormatRupiah(in.Amount), domain.FormatRupiah(totals.Balance))
	}
	return struct {
		Charge *Row               `json:"charge"`
		Totals domain.FolioTotals `json:"totals"`
	}{charge, totals}, msg, nil
}
