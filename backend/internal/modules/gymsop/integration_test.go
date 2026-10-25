package gymsop

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymsop/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// memFiles keeps version PDFs in memory.
type memFiles map[string][]byte

func (m memFiles) SavePrivateDocument(data []byte, folder string) (string, error) {
	path := folder + "/" + testutil.RandomHex(4) + ".pdf"
	m[path] = data
	return path, nil
}

func (m memFiles) ReadPrivate(rel string) ([]byte, string, error) {
	data, ok := m[rel]
	if !ok {
		return nil, "", errors.New("missing")
	}
	return data, "application/pdf", nil
}

type sentWA struct{ phone, title, body string }

type recorder struct{ sent []sentWA }

func (r *recorder) WhatsApp(phone, title, body string) {
	r.sent = append(r.sent, sentWA{phone, title, body})
}

type sopFixture struct {
	t     *testing.T
	ctx   context.Context
	tx    pgx.Tx
	clock time.Time
	svc   *Service
	wa    *recorder
	files memFiles
	sfx   string
	by    Staff
}

func newSopFixture(t *testing.T) *sopFixture {
	f := &sopFixture{t: t, ctx: context.Background(), tx: testutil.Tx(t), wa: &recorder{}, files: memFiles{}, sfx: testutil.RandomHex(4),
		clock: time.Date(2031, 6, 2, 9, 0, 0, 0, localtime.Jakarta)}
	f.svc = NewService(f.tx, f.files, f.wa, func() time.Time { return f.clock }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	f.by = Staff{ID: f.user("Manajer", "pos", false, ""), Name: "Manajer"}
	return f
}

func (f *sopFixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var v string
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&v); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func (f *sopFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

// user creates an active staff account with role, a coach profile when
// coach is set, and an employee phone when phone is not "".
func (f *sopFixture) user(name, role string, coach bool, phone string) string {
	f.t.Helper()
	email := "sop-" + testutil.RandomHex(5) + "@test.local"
	id := f.scalar(`INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x') RETURNING id::text`, email)
	f.exec(`INSERT INTO configuration.users (id, full_name, role, email) VALUES ($1, $2, $3, $4)`, id, name+" "+f.sfx, role, email)
	if coach {
		f.exec(`INSERT INTO gym.coaches (name, user_id) VALUES ($1, $2)`, "Coach "+name+" "+f.sfx, id)
	}
	if phone != "" {
		f.exec(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date, user_id) VALUES ($1, $2, $3, $4, '2031-01-01', $5)`,
			name, "SOP"+testutil.RandomHex(4), email, phone, id)
	}
	return id
}

func (f *sopFixture) create(roles []string, body string) (string, *Detail) {
	f.t.Helper()
	id, err := f.svc.Create(f.ctx, f.by, NewDocument{
		VersionInput: domain.VersionInput{Title: "SOP Cuti " + f.sfx, Body: body}, AudienceRoles: roles, RemindAfterDays: 3,
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return id, f.get(id)
}

func (f *sopFixture) get(id string) *Detail {
	f.t.Helper()
	d, err := f.svc.Get(f.ctx, id)
	if err != nil || d == nil {
		f.t.Fatalf("get %s: %v", id, err)
	}
	return d
}

func (f *sopFixture) mine(userID string) []MySop {
	f.t.Helper()
	out, err := f.svc.Mine(f.ctx, userID)
	if err != nil {
		f.t.Fatal(err)
	}
	return out
}

func status(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func (f *sopFixture) reminders(versionID, source string) int {
	f.t.Helper()
	var n int
	if err := f.tx.QueryRow(f.ctx, `SELECT count(*) FROM gym.sop_reminders WHERE version_id = $1 AND source = $2`, versionID, source).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

func TestSopVersionReadTracking(t *testing.T) {
	f := newSopFixture(t)
	role := "go_sop_" + f.sfx
	roleID := f.scalar(`INSERT INTO iam.roles (code, name) VALUES ($1, $1) RETURNING id::text`, role)
	// configuration.users.role only takes the built-in roles; other qc_staff
	// accounts in the database are readers too.
	f.exec(`INSERT INTO iam.roles (code, name) SELECT 'qc_staff', 'QC Staff' WHERE NOT EXISTS (SELECT 1 FROM iam.roles WHERE code = 'qc_staff')`)
	others, _ := strconv.Atoi(f.scalar(`SELECT count(*)::text FROM configuration.users WHERE role = 'qc_staff' AND status = 'active'`))
	coach := f.user("Rizky", "pos", true, "")
	viaUserRoles := f.user("Tara", "pos", false, "081234567890")
	viaColumn := f.user("Maya", "qc_staff", false, "")
	outsider := f.user("Budi", "pos", false, "")
	for _, u := range []string{coach, viaUserRoles} {
		f.exec(`INSERT INTO iam.user_roles (user_id, role_id) VALUES ($1, $2)`, u, roleID)
	}

	id, doc := f.create([]string{role, "qc_staff"}, "1. Ajukan cuti lewat Coach Portal.")
	if doc.ReadersTotal != 3+others || doc.ReadersAcked != 0 || doc.Version != 1 || len(doc.Readers) != 3+others {
		t.Fatalf("v1: %+v", doc.Document)
	}
	if got := f.mine(coach); len(got) != 1 || got[0].DocumentID != id || got[0].AcknowledgedAt != nil {
		t.Fatalf("coach sees %+v", got)
	}
	if got := f.mine(outsider); len(got) != 0 {
		t.Fatalf("outsider sees %+v", got)
	}
	if _, err := f.svc.Create(f.ctx, f.by, NewDocument{VersionInput: domain.VersionInput{Title: "X", Body: "x"}, AudienceRoles: []string{"no_such_" + f.sfx}}); status(err) != 400 {
		t.Fatalf("unknown role: %v", err)
	}

	v1 := doc.VersionID
	for range 2 {
		if err := f.svc.Acknowledge(f.ctx, coach, v1); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.svc.Acknowledge(f.ctx, outsider, v1); status(err) != 409 {
		t.Fatalf("outsider ack: %v", err)
	}
	last := func(d *Detail) Reader { return d.Readers[len(d.Readers)-1] }
	if doc = f.get(id); doc.ReadersAcked != 1 || last(doc).UserID != coach || last(doc).AcknowledgedAt == nil {
		t.Fatalf("after ack: %+v %+v", doc.Document, doc.Readers)
	}

	// A new version asks everyone again; the old one can no longer be confirmed.
	f.clock = f.clock.Add(time.Hour)
	v, err := f.svc.Publish(f.ctx, f.by, id, NewVersion{VersionInput: domain.VersionInput{Title: "SOP Cuti v2 " + f.sfx, Body: "2. Cari pengganti.", ChangeNote: "pengganti"}})
	if err != nil || v != 2 {
		t.Fatalf("publish: %d %v", v, err)
	}
	doc = f.get(id)
	if doc.Version != 2 || doc.ReadersAcked != 0 || doc.Title != "SOP Cuti v2 "+f.sfx || len(doc.Versions) != 2 ||
		doc.Versions[0].Acked != 0 || doc.Versions[1].Acked != 1 || doc.Versions[0].ChangeNote != "pengganti" {
		t.Fatalf("v2: %+v %+v", doc.Document, doc.Versions)
	}
	if got := f.mine(coach); len(got) != 1 || got[0].Version != 2 || got[0].AcknowledgedAt != nil {
		t.Fatalf("coach after v2: %+v", got)
	}
	if err := f.svc.Acknowledge(f.ctx, coach, v1); status(err) != 409 {
		t.Fatalf("old version ack: %v", err)
	}
	if err := f.svc.Acknowledge(f.ctx, viaColumn, doc.VersionID); err != nil {
		t.Fatal(err)
	}
	if doc = f.get(id); doc.ReadersAcked != 1 {
		t.Fatalf("v2 acked: %+v", doc.Document)
	}

	// Switched off, it drops out of everyone's list.
	off := false
	if err := f.svc.Update(f.ctx, id, DocumentPatch{Active: &off}); err != nil {
		t.Fatal(err)
	}
	if got := f.mine(coach); len(got) != 0 {
		t.Fatalf("inactive: %+v", got)
	}
	if _, err := f.svc.Remind(f.ctx, f.by, id); status(err) != 409 {
		t.Fatalf("remind inactive: %v", err)
	}
}

func TestSopAudienceDefaultsToCoaches(t *testing.T) {
	f := newSopFixture(t)
	coach := f.user("Kevin", "pos", true, "")
	staff := f.user("Desk", "pos", false, "")
	f.create(nil, "Isi")
	if got := f.mine(coach); len(got) != 1 {
		t.Fatalf("coach: %+v", got)
	}
	if got := f.mine(staff); len(got) != 0 {
		t.Fatalf("staff without a coach profile: %+v", got)
	}
}

func TestSopReminderDedupe(t *testing.T) {
	f := newSopFixture(t)
	role := "go_sop_" + f.sfx
	roleID := f.scalar(`INSERT INTO iam.roles (code, name) VALUES ($1, $1) RETURNING id::text`, role)
	a := f.user("Ayu", "pos", false, "0811000111")
	b := f.user("Bima", "pos", false, "")
	c := f.user("Cici", "pos", false, "")
	for _, u := range []string{a, b, c} {
		f.exec(`INSERT INTO iam.user_roles (user_id, role_id) VALUES ($1, $2)`, u, roleID)
	}
	published := f.clock
	manual, doc := f.create([]string{role}, "Manual")
	zero := 0
	if err := f.svc.Update(f.ctx, manual, DocumentPatch{RemindAfterDays: &zero}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Acknowledge(f.ctx, c, doc.VersionID); err != nil {
		t.Fatal(err)
	}

	// Manual: the unread readers, once a Jakarta day.
	res, err := f.svc.Remind(f.ctx, f.by, manual)
	if err != nil || res != (RemindResult{Pending: 2, Sent: 2}) {
		t.Fatalf("first remind: %+v %v", res, err)
	}
	if len(f.wa.sent) != 1 || f.wa.sent[0].phone != "0811000111" || f.wa.sent[0].title != "SOP perlu dibaca" {
		t.Fatalf("whatsapp: %+v", f.wa.sent)
	}
	var inbox int
	if err := f.tx.QueryRow(f.ctx, `SELECT count(*) FROM public.notifications WHERE user_id = ANY ($1::uuid[])
	    AND type = 'reminder' AND link = $2 AND metadata->>'sop_version_id' = $3`, []string{a, b, c}, InboxLink, doc.VersionID).Scan(&inbox); err != nil || inbox != 2 {
		t.Fatalf("inbox rows %d %v", inbox, err)
	}
	f.clock = f.clock.Add(10 * time.Hour) // 19:00 WIB, same day
	if res, _ = f.svc.Remind(f.ctx, f.by, manual); res != (RemindResult{Pending: 2, Skipped: 2}) {
		t.Fatalf("same day: %+v", res)
	}
	f.clock = f.clock.Add(6 * time.Hour) // 01:00 WIB next day
	if res, _ = f.svc.Remind(f.ctx, f.by, manual); res != (RemindResult{Pending: 2, Sent: 2}) {
		t.Fatalf("next day: %+v", res)
	}

	// The job: remind_after_days 3 on its own document; the manual-only
	// document is never touched.
	f.clock = published
	auto, autoDoc := f.create([]string{role}, "Otomatis")
	_ = auto
	job := func(at time.Time) {
		t.Helper()
		if err := f.svc.RemindOverdue(f.ctx, at); err != nil {
			t.Fatal(err)
		}
	}
	day := 24 * time.Hour
	job(published.Add(2 * day))
	if n := f.reminders(autoDoc.VersionID, domain.SourceJob); n != 0 {
		t.Fatalf("too early: %d", n)
	}
	job(published.Add(3 * day))
	if n := f.reminders(autoDoc.VersionID, domain.SourceJob); n != 3 {
		t.Fatalf("after 3 days: %d", n)
	}
	job(published.Add(3*day + time.Hour)) // the next hourly run
	job(published.Add(5 * day))
	if n := f.reminders(autoDoc.VersionID, domain.SourceJob); n != 3 {
		t.Fatalf("deduped: %d", n)
	}
	if err := f.svc.Acknowledge(f.ctx, a, autoDoc.VersionID); err != nil {
		t.Fatal(err)
	}
	job(published.Add(6 * day))
	if n := f.reminders(autoDoc.VersionID, domain.SourceJob); n != 5 {
		t.Fatalf("second round for the two unread: %d", n)
	}
	if n := f.reminders(doc.VersionID, domain.SourceJob); n != 0 {
		t.Fatalf("manual-only document reminded by the job: %d", n)
	}
}

func TestSopAttachment(t *testing.T) {
	f := newSopFixture(t)
	coach := f.user("Rizky", "pos", true, "")
	outsider := f.user("Budi", "pos", false, "")
	pdf := []byte("%PDF-1.4 sop")
	id, err := f.svc.Create(f.ctx, f.by, NewDocument{VersionInput: domain.VersionInput{Title: "SOP PDF " + f.sfx}, PDF: pdf, PDFName: "sop-cuti.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	doc := f.get(id)
	if doc.AttachmentName == nil || *doc.AttachmentName != "sop-cuti.pdf" {
		t.Fatalf("attachment: %+v", doc)
	}
	if data, _, name, err := f.svc.Attachment(f.ctx, coach, doc.VersionID, false); err != nil || string(data) != string(pdf) || name != "sop-cuti.pdf" {
		t.Fatalf("reader: %v", err)
	}
	if _, _, _, err := f.svc.Attachment(f.ctx, outsider, doc.VersionID, false); status(err) != 404 {
		t.Fatalf("outsider: %v", err)
	}
	if _, _, _, err := f.svc.Attachment(f.ctx, outsider, doc.VersionID, true); err != nil {
		t.Fatalf("manager: %v", err)
	}
	if _, err := f.svc.Create(f.ctx, f.by, NewDocument{VersionInput: domain.VersionInput{Title: "Bukan PDF"}, PDF: []byte("hello")}); status(err) != 400 {
		t.Fatalf("not a pdf: %v", err)
	}
	// A new version keeps the PDF on request, or needs content.
	if _, err := f.svc.Publish(f.ctx, f.by, id, NewVersion{VersionInput: domain.VersionInput{Title: "SOP PDF v2"}, KeepAttachment: true}); err != nil {
		t.Fatal(err)
	}
	if doc = f.get(id); doc.Version != 2 || doc.AttachmentName == nil {
		t.Fatalf("kept: %+v", doc)
	}
	if _, err := f.svc.Publish(f.ctx, f.by, id, NewVersion{VersionInput: domain.VersionInput{Title: "Kosong"}}); status(err) != 400 {
		t.Fatalf("empty version: %v", err)
	}
}
