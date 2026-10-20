package gymcoaching

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// PersonalType is an active class type flagged personal training.
type PersonalType struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	DurationMin int    `json:"duration_min"`
	CreditCost  int    `json:"credit_cost"`
	Capacity    int    `json:"capacity"`
}

const personalTypeColumns = `id::text, name, description, default_duration_min, default_credit_cost, LEAST(default_capacity, 4)`

// PersonalTypes lists the active personal training class types.
func (s *Service) PersonalTypes(ctx context.Context) ([]PersonalType, error) {
	rows, err := s.db.Query(ctx, `SELECT `+personalTypeColumns+` FROM gym.class_types
       WHERE is_personal AND status = 'active' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[PersonalType])
}

func (s *Service) personalType(ctx context.Context, q Q, id string) (PersonalType, error) {
	rows, err := q.Query(ctx, `SELECT `+personalTypeColumns+` FROM gym.class_types
       WHERE id = $1 AND is_personal AND status = 'active'`, id)
	if err != nil {
		return PersonalType{}, err
	}
	t, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[PersonalType])
	if isNoRows(err) {
		return t, httpx.NotFound("Jenis sesi PT tidak ditemukan")
	}
	return t, err
}

// ClassTypeFlag is a class type with its personal training flag, for the
// PT settings list.
type ClassTypeFlag struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsPersonal bool   `json:"is_personal"`
}

// ClassTypeFlags lists every active class type with its flag.
func (s *Service) ClassTypeFlags(ctx context.Context) ([]ClassTypeFlag, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, name, is_personal FROM gym.class_types WHERE status = 'active' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ClassTypeFlag])
}

// SetPersonal flags a class type as personal training or clears the flag.
// A type with open PT appointments keeps its flag.
func (s *Service) SetPersonal(ctx context.Context, id string, personal bool) error {
	return s.inTx(ctx, func(q Q) error {
		var current bool
		err := q.QueryRow(ctx, `SELECT is_personal FROM gym.class_types WHERE id = $1 FOR UPDATE`, id).Scan(&current)
		if isNoRows(err) {
			return httpx.NotFound("Jenis kelas tidak ditemukan")
		}
		if err != nil || current == personal {
			return err
		}
		if !personal {
			var open bool
			if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.pt_appointments
              WHERE class_type_id = $1 AND status IN ('requested', 'confirmed'))`, id).Scan(&open); err != nil {
				return err
			}
			if open {
				return conflict("Masih ada sesi PT terbuka untuk jenis ini")
			}
		}
		_, err = q.Exec(ctx, `UPDATE gym.class_types SET is_personal = $2, updated_at = now() WHERE id = $1`, id, personal)
		return err
	})
}

// ── Reads ───────────────────────────────────────────────────────────────────

// Participant is a member in an appointment.
type Participant struct {
	ID             string        `json:"id"`
	AppointmentID  string        `json:"appointment_id"`
	CustomerID     string        `json:"customer_id"`
	Name           *string       `json:"name"`
	Phone          *string       `json:"phone"`
	Status         domain.Status `json:"status"`
	LateCancel     bool          `json:"late_cancel"`
	CreditsCharged int           `json:"credits_charged"`
}

// Appointment is a PT session with its participants.
type Appointment struct {
	ID            string        `json:"id"`
	CoachID       string        `json:"coach_id"`
	CoachName     string        `json:"coach_name"`
	ClassTypeID   string        `json:"class_type_id"`
	ClassTypeName string        `json:"class_type_name"`
	BranchID      *string       `json:"branch_id"`
	BranchName    *string       `json:"branch_name"`
	Timezone      string        `json:"timezone"`
	StartsAt      httpx.JSTime  `json:"starts_at"`
	EndsAt        httpx.JSTime  `json:"ends_at"`
	Capacity      int           `json:"capacity"`
	CreditCost    int           `json:"credit_cost"`
	Status        domain.Status `json:"status"`
	Source        string        `json:"source"`
	Notes         string        `json:"notes"`
	CancelReason  *string       `json:"cancel_reason"`
	CreatedAt     httpx.JSTime  `json:"created_at"`
	Participants  []Participant `json:"participants"`
}

func (a *Appointment) start() time.Time { return time.Time(a.StartsAt) }

// when is the start as "Sab, 24 Okt, 18.00" in the branch zone.
func (a *Appointment) when() string { return localtime.Format(a.start(), localtime.Zone(a.Timezone)) }

// Filter narrows the appointment list. Zero values do not filter.
type Filter struct {
	From, To   time.Time
	CoachID    string
	CustomerID string
	Status     domain.Status
}

const appointmentSelect = `SELECT a.id::text, a.coach_id::text, c.name, a.class_type_id::text, t.name, a.branch_id::text, b.name,
       COALESCE(b.timezone, 'Asia/Jakarta'), a.starts_at, a.ends_at, a.capacity, a.credit_cost, a.status, a.source, a.notes, a.cancel_reason, a.created_at
  FROM gym.pt_appointments a
  JOIN gym.coaches c ON c.id = a.coach_id
  JOIN gym.class_types t ON t.id = a.class_type_id
  LEFT JOIN configuration.branches b ON b.id = a.branch_id`

func scanAppointment(r pgx.CollectableRow) (*Appointment, error) {
	var a Appointment
	var start, end, created time.Time
	err := r.Scan(&a.ID, &a.CoachID, &a.CoachName, &a.ClassTypeID, &a.ClassTypeName, &a.BranchID, &a.BranchName,
		&a.Timezone, &start, &end, &a.Capacity, &a.CreditCost, &a.Status, &a.Source, &a.Notes, &a.CancelReason, &created)
	a.StartsAt, a.EndsAt, a.CreatedAt = httpx.JSTime(start), httpx.JSTime(end), httpx.JSTime(created)
	a.Participants = []Participant{}
	return &a, err
}

// withParticipants fills in the participants of the appointments.
func withParticipants(ctx context.Context, q Q, list []*Appointment) error {
	if len(list) == 0 {
		return nil
	}
	byID := make(map[string]*Appointment, len(list))
	ids := make([]string, len(list))
	for i, a := range list {
		byID[a.ID], ids[i] = a, a.ID
	}
	rows, err := q.Query(ctx, `SELECT p.id::text, p.appointment_id::text, p.customer_id::text, c.name, c.phone,
       p.status, p.late_cancel, p.credits_charged
  FROM gym.pt_participants p
  JOIN pos.pos_customers c ON c.id = p.customer_id
 WHERE p.appointment_id = ANY($1::uuid[])
 ORDER BY p.created_at`, ids)
	if err != nil {
		return err
	}
	parts, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Participant])
	for _, p := range parts {
		a := byID[p.AppointmentID]
		a.Participants = append(a.Participants, p)
	}
	return err
}

// Appointments lists PT sessions starting in [From, To), at most 500.
func (s *Service) Appointments(ctx context.Context, f Filter) ([]*Appointment, error) {
	rows, err := s.db.Query(ctx, appointmentSelect+`
 WHERE a.starts_at >= $1 AND a.starts_at < $2
   AND ($3::uuid IS NULL OR a.coach_id = $3)
   AND ($4 = '' OR a.status = $4)
   AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM gym.pt_participants p WHERE p.appointment_id = a.id AND p.customer_id = $5))
 ORDER BY a.starts_at
 LIMIT 500`, f.From, f.To, nullable(f.CoachID), string(f.Status), nullable(f.CustomerID))
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanAppointment)
	if err != nil {
		return nil, err
	}
	return list, withParticipants(ctx, s.db, list)
}

// Appointment reads one session; nil when it does not exist.
func (s *Service) Appointment(ctx context.Context, id string) (*Appointment, error) {
	return loadAppointment(ctx, s.db, id, false)
}

func loadAppointment(ctx context.Context, q Q, id string, lock bool) (*Appointment, error) {
	sql := appointmentSelect + ` WHERE a.id = $1`
	if lock {
		sql += ` FOR UPDATE OF a`
	}
	rows, err := q.Query(ctx, sql, id)
	if err != nil {
		return nil, err
	}
	a, err := pgx.CollectExactlyOneRow(rows, scanAppointment)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return a, withParticipants(ctx, q, []*Appointment{a})
}

func lockAppointment(ctx context.Context, q Q, id string) (*Appointment, error) {
	a, err := loadAppointment(ctx, q, id, true)
	if err == nil && a == nil {
		err = httpx.NotFound("Sesi PT tidak ditemukan")
	}
	return a, err
}

// ParticipantAppointment is the appointment of a participant row, "" when
// it does not exist.
func (s *Service) ParticipantAppointment(ctx context.Context, participantID string) (string, error) {
	var appointmentID string
	err := s.db.QueryRow(ctx, `SELECT appointment_id::text FROM gym.pt_participants WHERE id = $1`, participantID).Scan(&appointmentID)
	if isNoRows(err) {
		return "", nil
	}
	return appointmentID, err
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ── Booking ─────────────────────────────────────────────────────────────────

// BookInput is a staff or coach booking: confirmed at once, for 1 to
// Capacity members.
type BookInput struct {
	CoachID     string
	ClassTypeID string
	BranchID    *string
	StartsAt    time.Time
	Capacity    int // 0 = the class type's capacity
	CustomerIDs []string
	Notes       string
	ActorID     string
}

// Book creates a confirmed session. The coach must be free; availability
// windows do not bind staff.
func (s *Service) Book(ctx context.Context, in BookInput) (string, error) {
	var id string
	err := s.inTx(ctx, func(q Q) error {
		ct, err := s.personalType(ctx, q, in.ClassTypeID)
		if err != nil {
			return err
		}
		capacity := in.Capacity
		if capacity == 0 {
			capacity = ct.Capacity
		}
		if capacity < 1 || capacity > domain.MaxCapacity {
			return httpx.BadRequest(fmt.Sprintf("Kapasitas PT 1 sampai %d orang", domain.MaxCapacity))
		}
		members := slices.Compact(slices.Sorted(slices.Values(in.CustomerIDs)))
		if len(members) == 0 || len(members) != len(in.CustomerIDs) || len(members) > capacity {
			return httpx.BadRequest("Pilih 1 sampai " + fmt.Sprint(capacity) + " member yang berbeda")
		}
		branch, err := s.coachBranch(ctx, q, in.CoachID, in.BranchID)
		if err != nil {
			return err
		}
		zone, err := localtime.BranchZone(ctx, q, branch)
		if err != nil {
			return err
		}
		end := in.StartsAt.Add(time.Duration(ct.DurationMin) * time.Minute)
		for _, m := range members {
			if err := s.checkMember(ctx, q, m, ct, in.StartsAt, end); err != nil {
				return err
			}
		}
		if err := s.claimCoach(ctx, q, "", in.CoachID, in.StartsAt, end); err != nil {
			return err
		}
		if err := q.QueryRow(ctx, `INSERT INTO gym.pt_appointments
          (coach_id, class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost, status, source, notes, created_by, confirmed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'staff', $8, $9, $10) RETURNING id::text`,
			in.CoachID, ct.ID, branch, in.StartsAt, end, capacity, ct.CreditCost, in.Notes, in.ActorID, s.now()).Scan(&id); err != nil {
			return err
		}
		for _, m := range members {
			if err := s.addParticipant(ctx, q, id, m, domain.Confirmed); err != nil {
				return err
			}
			s.notify(ctx, q, m, confirmedNotice(ct.Name, localtime.Format(in.StartsAt, zone)))
		}
		return nil
	})
	return id, err
}

// RequestInput is a member asking a coach for a 1:1 session.
type RequestInput struct {
	CustomerID  string
	CoachID     string
	ClassTypeID string
	StartsAt    time.Time
	Notes       string
}

// Request records a member's request for a slot of the coach's
// availability. The coach or the desk confirms it.
func (s *Service) Request(ctx context.Context, in RequestInput) (string, error) {
	var id string
	err := s.inTx(ctx, func(q Q) error {
		ct, err := s.personalType(ctx, q, in.ClassTypeID)
		if err != nil {
			return err
		}
		branch, err := s.coachBranch(ctx, q, in.CoachID, nil)
		if err != nil {
			return err
		}
		zone, err := localtime.BranchZone(ctx, q, branch)
		if err != nil {
			return err
		}
		rules, err := s.ports.Rules.ForBranch(ctx, q, branch)
		if err != nil {
			return err
		}
		if p := domain.RequestProblem(in.StartsAt, s.now(), rules); p != "" {
			return conflict(p)
		}
		end := in.StartsAt.Add(time.Duration(ct.DurationMin) * time.Minute)
		fits, err := fitsAvailability(ctx, q, in.CoachID, in.StartsAt, end)
		if err != nil {
			return err
		}
		if !fits {
			return conflict("Jam ini di luar jadwal PT coach")
		}
		if err := s.checkMember(ctx, q, in.CustomerID, ct, in.StartsAt, end); err != nil {
			return err
		}
		if err := s.claimCoach(ctx, q, "", in.CoachID, in.StartsAt, end); err != nil {
			return err
		}
		if err := q.QueryRow(ctx, `INSERT INTO gym.pt_appointments
          (coach_id, class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost, status, source, notes)
          VALUES ($1, $2, $3, $4, $5, 1, $6, 'requested', 'member', $7) RETURNING id::text`,
			in.CoachID, ct.ID, branch, in.StartsAt, end, ct.CreditCost, in.Notes).Scan(&id); err != nil {
			return err
		}
		if err := s.addParticipant(ctx, q, id, in.CustomerID, domain.Requested); err != nil {
			return err
		}
		s.notify(ctx, q, in.CustomerID, Notification{
			Type:  "gym_pt_requested",
			Title: "Permintaan PT terkirim",
			Body:  ct.Name + " pada " + localtime.Format(in.StartsAt, zone) + " menunggu konfirmasi coach.",
		})
		return nil
	})
	return id, err
}

// coachBranch checks the coach is active and returns the branch the session
// runs in: the one asked for, else the coach's.
func (s *Service) coachBranch(ctx context.Context, q Q, coachID string, branchID *string) (*string, error) {
	var own *string
	var active bool
	err := q.QueryRow(ctx, `SELECT branch_id::text, status = 'active' FROM gym.coaches WHERE id = $1`, coachID).Scan(&own, &active)
	if isNoRows(err) || (err == nil && !active) {
		return nil, httpx.NotFound("Coach tidak ditemukan")
	}
	if branchID != nil {
		return branchID, err
	}
	return own, err
}

// claimCoach takes the timetable lock and rejects a time the coach already
// teaches a class or a PT session.
func (s *Service) claimCoach(ctx context.Context, q Q, appointmentID, coachID string, start, end time.Time) error {
	if err := s.ports.Schedule.Lock(ctx, q); err != nil {
		return err
	}
	clash, err := s.ports.Schedule.CoachClash(ctx, q, appointmentID, coachID, start, end)
	if err == nil && clash != "" {
		err = conflict(clash)
	}
	return err
}

// checkMember rejects an inactive member, one already in another PT session
// at that time, or one whose PT credits do not cover this session on top of
// their other open sessions.
func (s *Service) checkMember(ctx context.Context, q Q, customerID string, ct PersonalType, start, end time.Time) error {
	var name *string
	var active *bool
	err := q.QueryRow(ctx, `SELECT name, is_active FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&name, &active)
	if isNoRows(err) {
		return httpx.NotFound("Member tidak ditemukan")
	}
	if err != nil {
		return err
	}
	label := "Member"
	if name != nil {
		label = *name
	}
	if active != nil && !*active {
		return conflict(label + " tidak aktif")
	}
	var busy bool
	var committed int
	if err := q.QueryRow(ctx, `SELECT
         COALESCE(bool_or(a.starts_at < $3 AND a.ends_at > $2), false),
         COALESCE(sum(a.credit_cost) FILTER (WHERE a.class_type_id = $4), 0)
       FROM gym.pt_participants p JOIN gym.pt_appointments a ON a.id = p.appointment_id
      WHERE p.customer_id = $1 AND p.status IN ('requested', 'confirmed')`,
		customerID, start, end, ct.ID).Scan(&busy, &committed); err != nil {
		return err
	}
	if busy {
		return conflict(label + " sudah punya sesi PT pada jam ini")
	}
	usable, err := s.ports.Credits.UsableBalance(ctx, q, customerID, ct.ID)
	if err != nil {
		return err
	}
	if !domain.HasCredits(usable, committed, ct.CreditCost) {
		return conflict(fmt.Sprintf("Kredit PT %s tidak cukup (tersedia %d, perlu %d)", label, max(usable-committed, 0), ct.CreditCost))
	}
	return nil
}

func (s *Service) addParticipant(ctx context.Context, q Q, appointmentID, customerID string, status domain.Status) error {
	_, err := q.Exec(ctx, `INSERT INTO gym.pt_participants (appointment_id, customer_id, status) VALUES ($1, $2, $3)`,
		appointmentID, customerID, status)
	return err
}

// confirmedNotice and cancelledNotice take the start already formatted in
// the branch zone.
func confirmedNotice(className, when string) Notification {
	return Notification{
		Type:  "gym_pt_confirmed",
		Title: "Sesi PT dikonfirmasi",
		Body:  className + " pada " + when + ". Datang 10 menit lebih awal.",
	}
}

func cancelledNotice(className, when, reason string) Notification {
	body := className + " pada " + when + " dibatalkan."
	if reason != "" {
		body += " Alasan: " + reason
	}
	return Notification{Type: "gym_pt_cancelled", Title: "Sesi PT dibatalkan", Body: body}
}
