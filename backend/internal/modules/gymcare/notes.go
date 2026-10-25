package gymcare

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcare/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Coach notes after a session. They may hold health detail, so only gym
// managers, their author and the coaches of the member's sessions today or
// later read them.

// SessionNote is one coach note on a member.
type SessionNote struct {
	ID              string     `json:"id" db:"id"`
	CustomerID      string     `json:"customer_id" db:"customer_id"`
	CoachID         string     `json:"coach_id" db:"coach_id"`
	CoachName       string     `json:"coach_name" db:"coach_name"`
	Body            string     `json:"body" db:"body"`
	CarryForward    bool       `json:"carry_forward" db:"carry_forward"`
	Pinned          bool       `json:"pinned" db:"pinned"`
	SessionID       *string    `json:"session_id" db:"session_id"`
	PTAppointmentID *string    `json:"pt_appointment_id" db:"pt_appointment_id"`
	SessionLabel    *string    `json:"session_label" db:"session_label"`
	SessionStartsAt *time.Time `json:"session_starts_at" db:"session_starts_at"`
	ReleasedAt      *time.Time `json:"released_at" db:"released_at"`
	ReleasedByName  string     `json:"released_by_name" db:"released_by_name"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
	// Mine marks the reader's own notes, the ones they may delete.
	Mine bool `json:"mine" db:"mine"`
}

// noteSelect reads notes with the viewer in $2 for Mine.
const noteSelect = `SELECT n.id::text, n.customer_id::text, n.coach_id::text, co.name AS coach_name, n.body, n.carry_forward,
       (n.carry_forward AND n.released_at IS NULL) AS pinned, n.session_id::text, n.pt_appointment_id::text,
       COALESCE(st.name, pt.name) AS session_label, COALESCE(s.starts_at, a.starts_at) AS session_starts_at,
       n.released_at, n.released_by_name, n.created_at, COALESCE(n.created_by = $2::uuid, false) AS mine
  FROM gym.member_session_notes n
  JOIN gym.coaches co ON co.id = n.coach_id
  LEFT JOIN gym.class_sessions s ON s.id = n.session_id
  LEFT JOIN gym.class_types st ON st.id = s.class_type_id
  LEFT JOIN gym.pt_appointments a ON a.id = n.pt_appointment_id
  LEFT JOIN gym.class_types pt ON pt.id = a.class_type_id`

// noteVisible is the condition on n for a note the viewer ($2, manager $3,
// now $4) may read: carried forward, or written in the last 60 days.
var noteVisible = `n.removed_at IS NULL
   AND ((n.carry_forward AND n.released_at IS NULL) OR n.created_at >= $4::timestamptz - interval '60 days')
   AND ($3::boolean OR n.created_by = $2::uuid OR ` + assignedSQL("n.customer_id", "$2::uuid", "$4") + `)`

func (s *Service) notes(ctx context.Context, v Viewer, ids []string) ([]SessionNote, error) {
	rows, err := s.db.Query(ctx, noteSelect+` WHERE n.customer_id = ANY($1::uuid[]) AND `+noteVisible+`
	  ORDER BY n.created_at DESC, n.id`, ids, v.ID, v.Manager, s.now())
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[SessionNote])
}

// MemberNotes is a roster's notes for one member.
type MemberNotes struct {
	CustomerID string        `json:"customer_id"`
	Notes      []SessionNote `json:"notes"`
}

// RosterNotes returns, per member in ids, the carried notes and the newest
// few others v may read.
func (s *Service) RosterNotes(ctx context.Context, v Viewer, ids []string) ([]MemberNotes, error) {
	out := make([]MemberNotes, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	all, err := s.notes(ctx, v, ids)
	if err != nil {
		return nil, err
	}
	for i, id := range ids {
		var mine []SessionNote
		var refs []domain.NoteRef
		for _, n := range all {
			if n.CustomerID == id {
				mine = append(mine, n)
				refs = append(refs, domain.NoteRef{Pinned: n.Pinned, CreatedAt: n.CreatedAt})
			}
		}
		out[i] = MemberNotes{CustomerID: id, Notes: []SessionNote{}}
		for _, j := range domain.RosterNotes(refs, domain.RosterHistoryLimit) {
			out[i].Notes = append(out[i].Notes, mine[j])
		}
	}
	return out, nil
}

// History is every note on the member v may read: the carried ones and the
// last 60 days, newest first.
func (s *Service) History(ctx context.Context, v Viewer, customerID string) ([]SessionNote, error) {
	out, err := s.notes(ctx, v, []string{customerID})
	if out == nil {
		out = []SessionNote{}
	}
	return out, err
}

// NewNote is a note a coach writes after a class (SessionID) or a PT
// session (PTAppointmentID).
type NewNote struct {
	CustomerID      string
	SessionID       *string
	PTAppointmentID *string
	Body            string
	CarryForward    bool
}

// AddNote stores a note by the caller's coach profile on a session it
// coached, for a member who held a place in it, from its start until
// NoteWriteDays later.
func (s *Service) AddNote(ctx context.Context, v Viewer, in NewNote) (*SessionNote, error) {
	if !domain.ValidSessionNote(in.Body) {
		return nil, httpx.BadRequest("Catatan wajib diisi, maksimal 500 karakter")
	}
	if (in.SessionID == nil) == (in.PTAppointmentID == nil) {
		return nil, httpx.BadRequest("Pilih satu sesi kelas atau PT")
	}
	coachID, err := requireCoach(ctx, s.db, v.ID)
	if err != nil {
		return nil, err
	}
	var startsAt time.Time
	var inSession bool
	if in.SessionID != nil {
		err = s.db.QueryRow(ctx, `SELECT s.starts_at, EXISTS (SELECT 1 FROM gym.bookings b WHERE b.session_id = s.id
		      AND b.customer_id = $3 AND b.status IN ('confirmed', 'checked_in', 'completed', 'no_show'))
		    FROM gym.class_sessions s WHERE s.id = $1 AND s.coach_id = $2 AND s.status <> 'cancelled'`,
			*in.SessionID, coachID, in.CustomerID).Scan(&startsAt, &inSession)
	} else {
		err = s.db.QueryRow(ctx, `SELECT a.starts_at, EXISTS (SELECT 1 FROM gym.pt_participants p WHERE p.appointment_id = a.id
		      AND p.customer_id = $3 AND p.status <> 'cancelled')
		    FROM gym.pt_appointments a WHERE a.id = $1 AND a.coach_id = $2 AND a.status <> 'cancelled'`,
			*in.PTAppointmentID, coachID, in.CustomerID).Scan(&startsAt, &inSession)
	}
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Sesi tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if !inSession {
		return nil, httpx.BadRequest("Member ini tidak ada di sesi tersebut")
	}
	if !domain.CanWriteNote(startsAt, s.now()) {
		return nil, httpx.Conflict("Catatan ditulis setelah sesi dimulai, paling lama 7 hari sesudahnya")
	}
	var id string
	if err := s.db.QueryRow(ctx, `INSERT INTO gym.member_session_notes
	    (customer_id, session_id, pt_appointment_id, coach_id, body, carry_forward, created_by, created_at, updated_at)
	    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id::text`,
		in.CustomerID, in.SessionID, in.PTAppointmentID, coachID, in.Body, in.CarryForward, v.ID, s.now()).Scan(&id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, noteSelect+` WHERE n.id = $1`, id, v.ID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[SessionNote])
}

// noteMeta locks a note v may read; 404 otherwise.
func (s *Service) noteMeta(ctx context.Context, q database.Querier, v Viewer, id string) (carried bool, mine bool, err error) {
	err = q.QueryRow(ctx, `SELECT n.carry_forward AND n.released_at IS NULL, COALESCE(n.created_by = $2::uuid, false)
	    FROM gym.member_session_notes n WHERE n.id = $1 AND `+noteVisible+` FOR UPDATE OF n`,
		id, v.ID, v.Manager, s.now()).Scan(&carried, &mine)
	if database.IsNoRows(err) {
		err = httpx.NotFound("Catatan tidak ditemukan")
	}
	return carried, mine, err
}

// ReleaseNote stops a carried note from showing on the member's next
// sessions (the injury healed, the cue stuck). Any reader may release it;
// releasing twice changes nothing.
func (s *Service) ReleaseNote(ctx context.Context, v Viewer, id string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		carried, _, err := s.noteMeta(ctx, tx, v, id)
		if err != nil || !carried {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE gym.member_session_notes SET released_at = $2, released_by = $3, released_by_name = $4,
		    updated_at = $2 WHERE id = $1`, id, s.now(), v.ID, v.Name)
		return err
	})
}

// DeleteNote soft-deletes a note; only its author may.
func (s *Service) DeleteNote(ctx context.Context, v Viewer, id string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		_, mine, err := s.noteMeta(ctx, tx, v, id)
		if err != nil {
			return err
		}
		if !mine {
			return httpx.Forbidden("Hanya penulis yang bisa menghapus catatan ini")
		}
		_, err = tx.Exec(ctx, `UPDATE gym.member_session_notes SET removed_at = $2, updated_at = $2 WHERE id = $1`, id, s.now())
		return err
	})
}
