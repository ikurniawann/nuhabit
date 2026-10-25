package gymscheduling

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/importer"
)

// CSV/XLSX imports of the gym catalog: class types, coaches and weekly
// schedule templates. Rows are matched by their natural key (the name, or
// the class type + branch + weekday + start time of a template), so a file
// can be imported again after corrections. Every row runs the same create
// and update paths as the forms; see backend/docs/DATA_SETUP.md.

var classTypeSpec = importer.Spec{
	Entity: "gym.class_types", FileName: "template-jenis-kelas.csv",
	Columns: []importer.Column{
		{Key: "nama", Label: "Nama", Required: true, Help: "Nama jenis kelas, kunci unik (3-80 karakter)"},
		{Key: "deskripsi", Label: "Deskripsi", Help: "Maksimal 500 karakter"},
		{Key: "durasi_menit", Label: "Durasi (menit)", Required: true, Help: "15-240"},
		{Key: "biaya_kredit", Label: "Biaya kredit", Required: true, Help: "1-20 kredit per sesi"},
		{Key: "kapasitas", Label: "Kapasitas", Required: true, Help: "1-200 peserta"},
		{Key: "warna", Label: "Warna", Help: "lime, info, warning, danger, success atau ink (default lime)"},
		{Key: "status", Label: "Status", Help: "active atau archived (default active)"},
	},
	Sample: [][]string{
		{"Engine Builder", "Conditioning berat lari untuk membangun race pace.", "60", "1", "20", "info", "active"},
		{"Strength Circuit", "Sled push, sled pull, carry, dan lunge.", "75", "1", "14", "warning", "active"},
	},
}

var coachSpec = importer.Spec{
	Entity: "gym.coaches", FileName: "template-coach.csv",
	Columns: []importer.Column{
		{Key: "nama", Label: "Nama", Required: true, Help: "Nama coach, kunci unik (3-80 karakter)"},
		{Key: "bio", Label: "Bio", Help: "Maksimal 1000 karakter"},
		{Key: "spesialisasi", Label: "Spesialisasi", Help: "Maksimal 120 karakter"},
		{Key: "cabang", Label: "Cabang", Help: "Kode cabang (Pengaturan > Bisnis); kosong = semua cabang"},
		{Key: "email_user", Label: "Email user", Help: "Email akun staf yang ditautkan untuk menu Kelas Saya"},
		{Key: "status", Label: "Status", Help: "active atau inactive (default active)"},
	},
	Sample: [][]string{
		{"Kevin Hartono", "Spesialis engine dan race simulation.", "Engine & simulation", "DAGO", "kevin@nuhabit.id", "active"},
	},
}

var templateSpec = importer.Spec{
	Entity: "gym.session_templates", FileName: "template-jadwal-mingguan.csv",
	Columns: []importer.Column{
		{Key: "jenis_kelas", Label: "Jenis kelas", Required: true, Help: "Nama jenis kelas yang sudah ada"},
		{Key: "cabang", Label: "Cabang", Help: "Kode cabang; kosong = tanpa cabang"},
		{Key: "hari", Label: "Hari", Required: true, Help: "Senin..Minggu atau 1..7"},
		{Key: "jam_mulai", Label: "Jam mulai", Required: true, Help: "HH:MM dalam zona waktu cabang"},
		{Key: "durasi_menit", Label: "Durasi (menit)", Help: "15-240; kosong = default jenis kelas"},
		{Key: "coach", Label: "Coach", Help: "Nama coach yang sudah ada; kosong = belum ditentukan"},
		{Key: "kapasitas", Label: "Kapasitas", Help: "1-200; kosong = default jenis kelas"},
		{Key: "biaya_kredit", Label: "Biaya kredit", Help: "1-20; kosong = default jenis kelas"},
		{Key: "berlaku_mulai", Label: "Berlaku mulai", Help: "YYYY-MM-DD; kosong = hari ini"},
		{Key: "berlaku_sampai", Label: "Berlaku sampai", Help: "YYYY-MM-DD; kosong = tanpa batas"},
		{Key: "area", Label: "Area", Help: "Ruangan atau area, maksimal 80 karakter"},
		{Key: "aktif", Label: "Aktif", Help: "ya atau tidak (default ya)"},
	},
	Sample: [][]string{
		{"Engine Builder", "DAGO", "Senin", "06:30", "60", "Kevin Hartono", "20", "1", "2026-11-01", "", "Main Floor", "ya"},
		{"Strength Circuit", "DAGO", "Rabu", "17:30", "", "Maya Kusuma", "", "", "2026-11-01", "", "Sled Lane", "ya"},
	},
}

// importOptions are the run options of one upload by user.
func importOptions(r *http.Request, user *auth.User, spec importer.Spec, dryRun bool) importer.Options {
	return importer.Options{DryRun: dryRun, Entity: spec.Entity, ActorID: user.ID, ActorName: user.FullName, Request: r}
}

func (h *handler) classTypeTemplate(w http.ResponseWriter, _ *http.Request, _ *auth.User) error {
	return importer.WriteTemplate(w, classTypeSpec)
}

func (h *handler) coachTemplate(w http.ResponseWriter, _ *http.Request, _ *auth.User) error {
	return importer.WriteTemplate(w, coachSpec)
}

func (h *handler) scheduleTemplateTemplate(w http.ResponseWriter, _ *http.Request, _ *auth.User) error {
	return importer.WriteTemplate(w, templateSpec)
}

func (h *handler) importClassTypes(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	up, err := importer.Read(r, classTypeSpec)
	if err != nil {
		return err
	}
	opts := importOptions(r, user, classTypeSpec, up.DryRun)
	opts.Log = h.log
	report, err := importer.Run(r.Context(), h.svc.db, opts, up.Rows, h.svc.importClassType)
	if err != nil {
		return err
	}
	return importer.Respond(w, report)
}

func (h *handler) importCoaches(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	up, err := importer.Read(r, coachSpec)
	if err != nil {
		return err
	}
	opts := importOptions(r, user, coachSpec, up.DryRun)
	opts.Log = h.log
	report, err := importer.Run(r.Context(), h.svc.db, opts, up.Rows, h.svc.importCoach)
	if err != nil {
		return err
	}
	return importer.Respond(w, report)
}

func (h *handler) importScheduleTemplates(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	up, err := importer.Read(r, templateSpec)
	if err != nil {
		return err
	}
	opts := importOptions(r, user, templateSpec, up.DryRun)
	opts.Log = h.log
	report, err := importer.Run(r.Context(), h.svc.db, opts, up.Rows, func(ctx context.Context, tx pgx.Tx, row importer.Row) (importer.Result, error) {
		return h.svc.importTemplate(ctx, tx, row, &user.ID)
	})
	if err != nil {
		return err
	}
	return importer.Respond(w, report)
}

// storedClassType is the class type row the import compares against.
type storedClassType struct {
	ID string
	ClassTypeInput
}

func (s *Service) classTypeByName(ctx context.Context, q Q, name string) (*storedClassType, error) {
	var t storedClassType
	err := q.QueryRow(ctx, `SELECT id::text, name, description, default_duration_min, default_credit_cost, default_capacity, color, status
		FROM gym.class_types WHERE lower(name) = lower($1)`, name).
		Scan(&t.ID, &t.Name, &t.Description, &t.DefaultDurationMin, &t.DefaultCreditCost, &t.DefaultCapacity, &t.Color, &t.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

func (s *Service) importClassType(ctx context.Context, tx pgx.Tx, row importer.Row) (importer.Result, error) {
	f := classTypeSpec.Fields(row)
	in := ClassTypeInput{Name: f.Text("nama", 80), Description: f.Text("deskripsi", 500), Color: "lime", Status: "active"}
	if len([]rune(in.Name)) < 3 && in.Name != "" {
		f.Fail("nama", "minimal 3 karakter")
	}
	in.DefaultDurationMin, _ = f.Int("durasi_menit", 15, 240)
	in.DefaultCreditCost, _ = f.Int("biaya_kredit", 1, 20)
	in.DefaultCapacity, _ = f.Int("kapasitas", 1, 200)
	if v, ok := f.Enum("warna", classColors); ok {
		in.Color = v
	}
	if v, ok := f.Enum("status", classTypeStatus); ok {
		in.Status = v
	}
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	res := importer.Result{Label: in.Name}
	stored, err := s.classTypeByName(ctx, tx, in.Name)
	if err != nil {
		return res, err
	}
	if stored == nil {
		id, err := s.repo.InsertClassType(ctx, tx, in)
		if err != nil {
			return res, err
		}
		if id == "" {
			return res, importer.Reject("Nama jenis kelas sudah dipakai")
		}
		res.Status = importer.Created
		return res, nil
	}
	if stored.ClassTypeInput == in {
		res.Status = importer.Unchanged
		return res, nil
	}
	err = s.updateClassType(ctx, tx, stored.ID, ClassTypePatch{
		Name: &in.Name, Description: &in.Description, DefaultDurationMin: &in.DefaultDurationMin,
		DefaultCreditCost: &in.DefaultCreditCost, DefaultCapacity: &in.DefaultCapacity, Color: &in.Color, Status: &in.Status,
	})
	if err != nil {
		return res, err
	}
	res.Status = importer.Updated
	return res, nil
}

// updateClassType is UpdateClassType on q, with row-level messages.
func (s *Service) updateClassType(ctx context.Context, q Q, id string, in ClassTypePatch) error {
	found, err := s.repo.UpdateClassType(ctx, q, id, in)
	switch {
	case database.IsUniqueViolation(err):
		return importer.Reject("Nama jenis kelas sudah dipakai")
	case err != nil:
		return err
	case found == "":
		return importer.Reject("Jenis kelas tidak ditemukan")
	}
	return nil
}

// storedCoach is the coach row the import compares against.
type storedCoach struct {
	ID string
	CoachInput
}

func (s *Service) coachByName(ctx context.Context, q Q, name string) (*storedCoach, error) {
	var c storedCoach
	err := q.QueryRow(ctx, `SELECT id::text, name, bio, specialization, photo_url, user_id::text, branch_id::text, status
		FROM gym.coaches WHERE lower(name) = lower($1)`, name).
		Scan(&c.ID, &c.Name, &c.Bio, &c.Specialization, &c.PhotoURL, &c.UserID, &c.BranchID, &c.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// branchByCode resolves an active branch by code (or name); "" when none.
func branchByCode(ctx context.Context, q Q, code string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM configuration.branches
		WHERE is_active AND (upper(code) = upper($1) OR lower(name) = lower($1))
		ORDER BY (upper(code) = upper($1)) DESC, created_at LIMIT 1`, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// staffByEmail resolves a staff account by email; "" when none.
func staffByEmail(ctx context.Context, q Q, email string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM configuration.users WHERE lower(email) = lower($1) ORDER BY created_at LIMIT 1`, email).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// optionalBranch reads the cabang column into a branch id; a code that
// matches no active branch fails the row.
func optionalBranch(ctx context.Context, q Q, f *importer.Fields) (*string, error) {
	code := f.Text("cabang", 80)
	if code == "" {
		return nil, nil
	}
	id, err := branchByCode(ctx, q, code)
	if err != nil {
		return nil, err
	}
	if id == "" {
		f.Fail("cabang", "tidak ditemukan: "+code)
		return nil, nil
	}
	return &id, nil
}

func (s *Service) importCoach(ctx context.Context, tx pgx.Tx, row importer.Row) (importer.Result, error) {
	f := coachSpec.Fields(row)
	in := CoachInput{Name: f.Text("nama", 80), Bio: f.Text("bio", 1000), Specialization: f.Text("spesialisasi", 120), Status: "active"}
	if len([]rune(in.Name)) < 3 && in.Name != "" {
		f.Fail("nama", "minimal 3 karakter")
	}
	branchID, err := optionalBranch(ctx, tx, f)
	if err != nil {
		return importer.Result{}, err
	}
	in.BranchID = branchID
	if email, ok := f.Email("email_user"); ok {
		userID, err := staffByEmail(ctx, tx, email)
		if err != nil {
			return importer.Result{}, err
		}
		if userID == "" {
			f.Fail("email_user", "tidak cocok dengan akun staf mana pun: "+email)
		} else {
			in.UserID = &userID
		}
	}
	if v, ok := f.Enum("status", coachStatuses); ok {
		in.Status = v
	}
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	res := importer.Result{Label: in.Name}
	stored, err := s.coachByName(ctx, tx, in.Name)
	if err != nil {
		return res, err
	}
	if stored == nil {
		id, err := s.repo.InsertCoach(ctx, tx, in)
		if err != nil {
			return res, err
		}
		if id == "" {
			return res, importer.Reject("Nama coach sudah dipakai")
		}
		res.Status = importer.Created
		return res, nil
	}
	if sameValue(stored.UserID, in.UserID) && sameValue(stored.BranchID, in.BranchID) &&
		stored.Name == in.Name && stored.Bio == in.Bio && stored.Specialization == in.Specialization && stored.Status == in.Status {
		res.Status = importer.Unchanged
		return res, nil
	}
	found, err := s.repo.UpdateCoach(ctx, tx, stored.ID, CoachPatch{
		Name: &in.Name, Bio: &in.Bio, Specialization: &in.Specialization, Status: &in.Status,
		BranchID: in.BranchID, BranchIDSent: true, UserID: in.UserID, UserIDSent: true,
	})
	if err != nil {
		return res, err
	}
	if found == "" {
		return res, importer.Reject("Coach tidak ditemukan")
	}
	res.Status = importer.Updated
	return res, nil
}

// templateByKey finds the template of a class type at a branch, weekday
// and start time; "" when none.
func templateByKey(ctx context.Context, q Q, classTypeID string, branchID *string, weekday int, start string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM gym.session_templates
		WHERE class_type_id = $1 AND branch_id IS NOT DISTINCT FROM $2::uuid AND weekday = $3 AND start_time = $4::time
		ORDER BY created_at LIMIT 1`, classTypeID, branchID, weekday, start).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func (s *Service) importTemplate(ctx context.Context, tx pgx.Tx, row importer.Row, createdBy *string) (importer.Result, error) {
	f := templateSpec.Fields(row)
	className := f.Text("jenis_kelas", 80)
	var classType *storedClassType
	if className != "" {
		var err error
		if classType, err = s.classTypeByName(ctx, tx, className); err != nil {
			return importer.Result{}, err
		}
		switch {
		case classType == nil:
			f.Fail("jenis_kelas", "tidak ditemukan: "+className)
		case classType.Status != "active":
			f.Fail("jenis_kelas", "sudah diarsipkan: "+className)
		}
	}
	branchID, err := optionalBranch(ctx, tx, f)
	if err != nil {
		return importer.Result{}, err
	}
	weekday, _ := f.Weekday("hari")
	start, _ := f.Clock("jam_mulai")
	in := TemplateInput{BranchID: branchID, Weekday: weekday, StartTime: start, Active: f.Bool("aktif", true)}
	if v, ok := f.Int("durasi_menit", 15, 240); ok {
		in.DurationMin = &v
	}
	if v, ok := f.Int("kapasitas", 1, 200); ok {
		in.Capacity = &v
	}
	if v, ok := f.Int("biaya_kredit", 1, 20); ok {
		in.CreditCost = &v
	}
	if coachName := f.Text("coach", 80); coachName != "" {
		coach, err := s.coachByName(ctx, tx, coachName)
		if err != nil {
			return importer.Result{}, err
		}
		if coach == nil {
			f.Fail("coach", "tidak ditemukan: "+coachName)
		} else {
			in.CoachID = &coach.ID
		}
	}
	in.ValidFrom, _ = f.Date("berlaku_mulai")
	if v, ok := f.Date("berlaku_sampai"); ok {
		in.ValidUntil = &v
	}
	if area := f.Text("area", 80); area != "" {
		in.Area = &area
	}
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	in.ClassTypeID = classType.ID
	label := className + " " + strings.ToLower(weekdayLabel(weekday)) + " " + start
	res := importer.Result{Label: label}
	id, err := templateByKey(ctx, tx, in.ClassTypeID, in.BranchID, in.Weekday, in.StartTime)
	if err != nil {
		return res, err
	}
	if id == "" {
		if _, err := s.createTemplate(ctx, tx, in, createdBy); err != nil {
			return res, err
		}
		res.Status = importer.Created
		return res, nil
	}
	stored, err := s.repo.GetTemplate(ctx, tx, id)
	if err != nil {
		return res, err
	}
	patch := TemplatePatch{
		CoachID: Optional[string]{Set: true, Value: in.CoachID}, Area: Optional[string]{Set: true, Value: in.Area},
		DurationMin: in.DurationMin, Capacity: in.Capacity, CreditCost: in.CreditCost,
		ValidUntil: Optional[string]{Set: true, Value: in.ValidUntil}, Active: &in.Active,
	}
	if in.ValidFrom != "" {
		patch.ValidFrom = &in.ValidFrom
	}
	if stored != nil && templateUnchanged(*stored, patch) {
		res.Status = importer.Unchanged
		return res, nil
	}
	if err := s.updateTemplate(ctx, tx, id, patch); err != nil {
		return res, err
	}
	res.Status = importer.Updated
	return res, nil
}

// templateUnchanged reports whether applying p to t changes nothing.
func templateUnchanged(t SessionTemplate, p TemplatePatch) bool {
	return sameValue(p.CoachID.Value, t.CoachID) && sameValue(p.Area.Value, t.Area) && sameValue(p.ValidUntil.Value, t.ValidUntil) &&
		(p.DurationMin == nil || *p.DurationMin == t.DurationMin) && (p.Capacity == nil || *p.Capacity == t.Capacity) &&
		(p.CreditCost == nil || *p.CreditCost == t.CreditCost) && (p.ValidFrom == nil || *p.ValidFrom == t.ValidFrom) &&
		(p.Active == nil || *p.Active == t.Active)
}

var weekdayLabels = [...]string{"", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"}

func weekdayLabel(d int) string {
	if d >= 1 && d <= 7 {
		return weekdayLabels[d]
	}
	return ""
}
