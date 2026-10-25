// Package gymsop is the coach SOP: versioned documents (markdown or a PDF)
// that every coach, or the staff of the roles a manager picks, must read and
// confirm. Publishing a new version asks everyone again. Managers see who
// read the latest version and remind the rest; a job reminds them after the
// document's remind_after_days.
//
// It owns gym.sop_documents, gym.sop_versions, gym.sop_acknowledgements and
// gym.sop_reminders.
package gymsop

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymsop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Name is the MODULES key.
const Name = "gym-sop"

// Messenger sends a WhatsApp message best effort, after the reminder is
// stored; a failure never fails the reminder.
type Messenger interface {
	WhatsApp(phone, title, body string)
}

// Files stores and reads version PDFs (platform/storage).
type Files interface {
	SavePrivateDocument(data []byte, folder string) (string, error)
	ReadPrivate(rel string) ([]byte, string, error)
}

// Service runs the SOP use cases.
type Service struct {
	db    database.DB
	files Files
	msg   Messenger
	now   func() time.Time
	log   *slog.Logger
}

// NewService builds the service; now nil is time.Now, log nil slog.Default.
func NewService(db database.DB, files Files, msg Messenger, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, files: files, msg: msg, now: now, log: log}
}

// Staff is the signed-in staff account.
type Staff struct{ ID, Name string }

// InboxLink is the page a reminder opens: Kelas Saya, with the SOP banner.
const InboxLink = "/dashboard/gym/my-classes?sop=1"

// latest is the newest version of document d.
const latest = `CROSS JOIN LATERAL (SELECT v.* FROM gym.sop_versions v WHERE v.document_id = d.id ORDER BY v.version DESC LIMIT 1) lv`

// readersOf lists the active staff accounts that must read document d: the
// accounts linked to an active coach when the audience is empty, else the
// accounts holding one of its roles (configuration.users.role or
// iam.user_roles).
const readersOf = `(SELECT u.id AS user_id, COALESCE(min(c.name), NULLIF(u.full_name, ''), u.email) AS name,
         bool_or(c.id IS NOT NULL) AS coach
    FROM configuration.users u
    LEFT JOIN gym.coaches c ON c.user_id = u.id AND c.status = 'active'
   WHERE u.status = 'active' AND (
         (cardinality(d.audience_roles) = 0 AND c.id IS NOT NULL)
      OR u.role = ANY (d.audience_roles)
      OR EXISTS (SELECT 1 FROM iam.user_roles ur JOIN iam.roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.code = ANY (d.audience_roles)))
   GROUP BY u.id, u.full_name, u.email)`

/* ── Manager ─────────────────────────────────────────────────────────────── */

// Document is one SOP with its latest version and read counts.
type Document struct {
	ID              string    `json:"id" db:"id"`
	Title           string    `json:"title" db:"title"`
	IsActive        bool      `json:"is_active" db:"is_active"`
	AudienceRoles   []string  `json:"audience_roles" db:"audience_roles"`
	RemindAfterDays int       `json:"remind_after_days" db:"remind_after_days"`
	VersionID       string    `json:"version_id" db:"version_id"`
	Version         int       `json:"version" db:"version"`
	PublishedAt     time.Time `json:"published_at" db:"published_at"`
	ChangeNote      string    `json:"change_note" db:"change_note"`
	ReadersTotal    int       `json:"readers_total" db:"readers_total"`
	ReadersAcked    int       `json:"readers_acked" db:"readers_acked"`
}

const documentSelect = `SELECT d.id::text, lv.title, d.is_active, d.audience_roles, d.remind_after_days,
       lv.id::text AS version_id, lv.version, lv.published_at, lv.change_note,
       (SELECT count(*) FROM ` + readersOf + ` rd)::int AS readers_total,
       (SELECT count(*) FROM ` + readersOf + ` rd
         JOIN gym.sop_acknowledgements a ON a.user_id = rd.user_id AND a.version_id = lv.id)::int AS readers_acked
  FROM gym.sop_documents d ` + latest

// List is every SOP, active first, newest version first.
func (s *Service) List(ctx context.Context) ([]Document, error) {
	rows, err := s.db.Query(ctx, documentSelect+` ORDER BY d.is_active DESC, lv.published_at DESC, d.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Document])
}

// Version is one published version.
type Version struct {
	ID              string    `json:"id" db:"id"`
	Version         int       `json:"version" db:"version"`
	Title           string    `json:"title" db:"title"`
	Body            string    `json:"body" db:"body"`
	AttachmentName  *string   `json:"attachment_name" db:"attachment_name"`
	ChangeNote      string    `json:"change_note" db:"change_note"`
	PublishedByName string    `json:"published_by_name" db:"published_by_name"`
	PublishedAt     time.Time `json:"published_at" db:"published_at"`
	Acked           int       `json:"acked" db:"acked"`
}

// Reader is one staff account that must read the latest version.
type Reader struct {
	UserID         string     `json:"user_id" db:"user_id"`
	Name           string     `json:"name" db:"name"`
	Coach          bool       `json:"coach" db:"coach"`
	AcknowledgedAt *time.Time `json:"acknowledged_at" db:"acknowledged_at"`
	LastRemindedAt *time.Time `json:"last_reminded_at" db:"last_reminded_at"`
}

// Detail is one SOP with every version and the read status of the latest.
type Detail struct {
	Document
	Body           string    `json:"body"`
	AttachmentName *string   `json:"attachment_name"`
	Versions       []Version `json:"versions"`
	Readers        []Reader  `json:"readers"`
}

// Get is the SOP id, nil when missing.
func (s *Service) Get(ctx context.Context, id string) (*Detail, error) {
	rows, err := s.db.Query(ctx, documentSelect+` WHERE d.id = $1`, id)
	if err != nil {
		return nil, err
	}
	doc, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Document])
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out := &Detail{Document: doc}
	rows, err = s.db.Query(ctx, `SELECT v.id::text, v.version, v.title, v.body, v.attachment_name, v.change_note,
	    v.published_by_name, v.published_at,
	    (SELECT count(*) FROM gym.sop_acknowledgements a WHERE a.version_id = v.id)::int AS acked
	  FROM gym.sop_versions v WHERE v.document_id = $1 ORDER BY v.version DESC`, id)
	if err != nil {
		return nil, err
	}
	if out.Versions, err = pgx.CollectRows(rows, pgx.RowToStructByName[Version]); err != nil {
		return nil, err
	}
	out.Body, out.AttachmentName = out.Versions[0].Body, out.Versions[0].AttachmentName
	out.Readers, err = s.readers(ctx, s.db, id, doc.VersionID)
	return out, err
}

// readers is the read status of version for every reader of document.
func (s *Service) readers(ctx context.Context, q database.Querier, document, version string) ([]Reader, error) {
	rows, err := q.Query(ctx, `SELECT rd.user_id::text, rd.name, rd.coach, a.acknowledged_at,
	    (SELECT max(r.sent_at) FROM gym.sop_reminders r WHERE r.version_id = $2 AND r.user_id = rd.user_id) AS last_reminded_at
	  FROM gym.sop_documents d CROSS JOIN LATERAL `+readersOf+` rd
	  LEFT JOIN gym.sop_acknowledgements a ON a.version_id = $2 AND a.user_id = rd.user_id
	 WHERE d.id = $1
	 ORDER BY a.acknowledged_at IS NOT NULL, rd.name, rd.user_id`, document, version)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Reader])
}

// NewDocument is a SOP to create with its first version.
type NewDocument struct {
	domain.VersionInput
	AudienceRoles   []string
	RemindAfterDays int
	PDF             []byte
	PDFName         string
}

func (s *Service) checkRoles(ctx context.Context, q database.Querier, roles []string) error {
	if len(roles) == 0 {
		return nil
	}
	var known int
	if err := q.QueryRow(ctx, `SELECT count(DISTINCT code)::int FROM iam.roles WHERE code = ANY ($1) AND deleted_at IS NULL`, roles).Scan(&known); err != nil {
		return err
	}
	if known != len(roles) {
		return httpx.BadRequest("Ada role yang tidak dikenal")
	}
	return nil
}

// savePDF stores a version PDF; the bytes must be a PDF.
func (s *Service) savePDF(data []byte) (*string, error) {
	if data == nil {
		return nil, nil
	}
	if len(data) > domain.AttachmentMaxBytes {
		return nil, httpx.BadRequest("Lampiran maksimal 10 MB")
	}
	if !strings.HasPrefix(string(data[:min(len(data), 5)]), "%PDF-") {
		return nil, httpx.BadRequest("Lampiran harus PDF")
	}
	path, err := s.files.SavePrivateDocument(data, "gym-sop/"+s.now().Format("2006-01"))
	if err != nil {
		return nil, httpx.BadRequest(err.Error())
	}
	return &path, nil
}

func nullableName(path *string, name string) *string {
	if path == nil {
		return nil
	}
	if name = strings.TrimSpace(name); name == "" {
		name = "sop.pdf"
	}
	return &name
}

// Create stores a SOP and its version 1.
func (s *Service) Create(ctx context.Context, by Staff, in NewDocument) (string, error) {
	in.HasAttachment = in.PDF != nil
	if msg := in.Validate(); msg != "" {
		return "", httpx.BadRequest(msg)
	}
	if in.AudienceRoles == nil {
		in.AudienceRoles = []string{}
	}
	if !domain.ValidRemindAfter(in.RemindAfterDays) {
		return "", httpx.BadRequest("Pengingat otomatis 0 sampai 60 hari")
	}
	if err := s.checkRoles(ctx, s.db, in.AudienceRoles); err != nil {
		return "", err
	}
	path, err := s.savePDF(in.PDF)
	if err != nil {
		return "", err
	}
	title := strings.TrimSpace(in.Title)
	var id string
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO gym.sop_documents (title, audience_roles, remind_after_days, created_by)
		    VALUES ($1, $2, $3, $4) RETURNING id::text`, title, in.AudienceRoles, in.RemindAfterDays, by.ID).Scan(&id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO gym.sop_versions (document_id, version, title, body, attachment_path, attachment_name,
		    change_note, published_by, published_by_name, published_at)
		    VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			id, title, in.Body, path, nullableName(path, in.PDFName), strings.TrimSpace(in.ChangeNote), by.ID, by.Name, s.now())
		return err
	})
	return id, err
}

// NewVersion is a version to publish on an existing SOP.
type NewVersion struct {
	domain.VersionInput
	PDF     []byte
	PDFName string
	// KeepAttachment reuses the previous version's PDF when no new one is sent.
	KeepAttachment bool
}

// Publish adds the next version; every reader must confirm it again.
func (s *Service) Publish(ctx context.Context, by Staff, id string, in NewVersion) (int, error) {
	var prevPath, prevName *string
	err := s.db.QueryRow(ctx, `SELECT lv.attachment_path, lv.attachment_name FROM gym.sop_documents d `+latest+` WHERE d.id = $1`, id).
		Scan(&prevPath, &prevName)
	if database.IsNoRows(err) {
		return 0, httpx.NotFound("Dokumen SOP tidak ditemukan")
	}
	if err != nil {
		return 0, err
	}
	keep := in.PDF == nil && in.KeepAttachment && prevPath != nil
	in.HasAttachment = in.PDF != nil || keep
	if msg := in.Validate(); msg != "" {
		return 0, httpx.BadRequest(msg)
	}
	path, err := s.savePDF(in.PDF)
	if err != nil {
		return 0, err
	}
	name := nullableName(path, in.PDFName)
	if keep {
		path, name = prevPath, prevName
	}
	title := strings.TrimSpace(in.Title)
	var version int
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM gym.sop_documents WHERE id = $1 FOR UPDATE`, id); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO gym.sop_versions (document_id, version, title, body, attachment_path, attachment_name,
		    change_note, published_by, published_by_name, published_at)
		    SELECT $1, COALESCE(max(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9 FROM gym.sop_versions WHERE document_id = $1
		    RETURNING version`,
			id, title, in.Body, path, name, strings.TrimSpace(in.ChangeNote), by.ID, by.Name, s.now()).Scan(&version); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE gym.sop_documents SET title = $2, updated_at = now() WHERE id = $1`, id, title)
		return err
	})
	return version, err
}

// DocumentPatch edits a SOP's settings; nil fields keep their value.
type DocumentPatch struct {
	AudienceRoles   []string
	AudienceSet     bool
	RemindAfterDays *int
	Active          *bool
}

// Update edits audience, reminder delay or the active switch.
func (s *Service) Update(ctx context.Context, id string, p DocumentPatch) error {
	if p.RemindAfterDays != nil && !domain.ValidRemindAfter(*p.RemindAfterDays) {
		return httpx.BadRequest("Pengingat otomatis 0 sampai 60 hari")
	}
	if p.AudienceSet {
		if err := s.checkRoles(ctx, s.db, p.AudienceRoles); err != nil {
			return err
		}
	}
	tag, err := s.db.Exec(ctx, `UPDATE gym.sop_documents SET
	    audience_roles = CASE WHEN $2 THEN $3 ELSE audience_roles END,
	    remind_after_days = COALESCE($4, remind_after_days), is_active = COALESCE($5, is_active), updated_at = now()
	  WHERE id = $1`, id, p.AudienceSet, p.AudienceRoles, p.RemindAfterDays, p.Active)
	if err == nil && tag.RowsAffected() == 0 {
		err = httpx.NotFound("Dokumen SOP tidak ditemukan")
	}
	return err
}

// Role is an IAM role a SOP may target.
type Role struct {
	Code string `json:"code" db:"code"`
	Name string `json:"name" db:"name"`
}

// Roles lists the IAM roles.
func (s *Service) Roles(ctx context.Context) ([]Role, error) {
	rows, err := s.db.Query(ctx, `SELECT code, name FROM iam.roles WHERE deleted_at IS NULL ORDER BY name, code`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Role])
}

/* ── Readers ─────────────────────────────────────────────────────────────── */

// MySop is the latest version of an active SOP the caller must read.
type MySop struct {
	DocumentID     string     `json:"document_id" db:"document_id"`
	VersionID      string     `json:"version_id" db:"version_id"`
	Version        int        `json:"version" db:"version"`
	Title          string     `json:"title" db:"title"`
	Body           string     `json:"body" db:"body"`
	AttachmentName *string    `json:"attachment_name" db:"attachment_name"`
	ChangeNote     string     `json:"change_note" db:"change_note"`
	PublishedAt    time.Time  `json:"published_at" db:"published_at"`
	AcknowledgedAt *time.Time `json:"acknowledged_at" db:"acknowledged_at"`
}

// Mine lists the SOPs userID must read, unread first.
func (s *Service) Mine(ctx context.Context, userID string) ([]MySop, error) {
	rows, err := s.db.Query(ctx, `SELECT d.id::text AS document_id, lv.id::text AS version_id, lv.version, lv.title, lv.body,
	    lv.attachment_name, lv.change_note, lv.published_at, a.acknowledged_at
	  FROM gym.sop_documents d `+latest+`
	  LEFT JOIN gym.sop_acknowledgements a ON a.version_id = lv.id AND a.user_id = $1
	 WHERE d.is_active AND EXISTS (SELECT 1 FROM `+readersOf+` rd WHERE rd.user_id = $1)
	 ORDER BY a.acknowledged_at IS NOT NULL, lv.published_at DESC, d.id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[MySop])
}

// Acknowledge records "Saya sudah membaca dan setuju" for the latest version
// of an active SOP the caller must read. Confirming twice changes nothing.
func (s *Service) Acknowledge(ctx context.Context, userID, versionID string) error {
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.sop_documents d `+latest+`
	    WHERE d.is_active AND lv.id = $2 AND EXISTS (SELECT 1 FROM `+readersOf+` rd WHERE rd.user_id = $1))`,
		userID, versionID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return httpx.Conflict("Versi SOP ini sudah tidak berlaku. Muat ulang untuk membaca versi terbaru.")
	}
	_, err := s.db.Exec(ctx, `INSERT INTO gym.sop_acknowledgements (version_id, user_id, acknowledged_at) VALUES ($1, $2, $3)
	  ON CONFLICT (version_id, user_id) DO NOTHING`, versionID, userID, s.now())
	return err
}

// Attachment reads a version's PDF for a manager (all) or a reader of its
// document.
func (s *Service) Attachment(ctx context.Context, userID, versionID string, all bool) ([]byte, string, string, error) {
	var path, name *string
	var reader bool
	err := s.db.QueryRow(ctx, `SELECT v.attachment_path, v.attachment_name,
	    EXISTS (SELECT 1 FROM `+readersOf+` rd WHERE rd.user_id = $2)
	  FROM gym.sop_versions v JOIN gym.sop_documents d ON d.id = v.document_id WHERE v.id = $1`, versionID, userID).
		Scan(&path, &name, &reader)
	if database.IsNoRows(err) || (err == nil && (path == nil || !(all || reader))) {
		return nil, "", "", httpx.NotFound("Lampiran tidak ditemukan")
	}
	if err != nil {
		return nil, "", "", err
	}
	data, mime, err := s.files.ReadPrivate(*path)
	if err != nil {
		return nil, "", "", httpx.NotFound("Lampiran tidak ditemukan")
	}
	return data, mime, *name, nil
}
