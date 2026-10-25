package hris

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/importer"
	"nuhabit/backend/internal/platform/module"
)

// CSV/XLSX import of the organisation: departments (by code), positions
// (by title) and employees (by email, then NIP), through the same save
// paths as the master data and employee forms. See
// backend/docs/DATA_SETUP.md.

var departmentSpec = importer.Spec{
	Entity: "hris.departments", FileName: "template-departemen.csv",
	Columns: []importer.Column{
		{Key: "kode", Label: "Kode", Required: true, Help: "Kode departemen, kunci unik (huruf besar)"},
		{Key: "nama", Label: "Nama", Required: true, Help: "Nama departemen"},
		{Key: "deskripsi", Label: "Deskripsi"},
		{Key: "aktif", Label: "Aktif", Help: "ya atau tidak (default ya)"},
	},
	Sample: [][]string{
		{"OPS", "Operasional Gym", "Front desk, coach dan kebersihan", "ya"},
		{"FIN", "Keuangan", "", "ya"},
	},
}

var positionSpec = importer.Spec{
	Entity: "hris.positions", FileName: "template-jabatan.csv",
	Columns: []importer.Column{
		{Key: "jabatan", Label: "Jabatan", Required: true, Help: "Nama jabatan, kunci unik"},
		{Key: "departemen", Label: "Departemen", Help: "Nama departemen yang sudah ada (default Operations)"},
		{Key: "level", Label: "Level", Help: "Staff, Senior Staff, Supervisor, Assistant Manager, Manager, Senior Manager, General Manager, Director atau C-Level (default Staff)"},
		{Key: "aktif", Label: "Aktif", Help: "ya atau tidak (default ya)"},
	},
	Sample: [][]string{
		{"Gym Manager", "Operasional Gym", "Manager", "ya"},
		{"Head Coach", "Operasional Gym", "Supervisor", "ya"},
		{"Front Desk", "Operasional Gym", "Staff", "ya"},
	},
}

var positionLevels = []string{"Staff", "Senior Staff", "Supervisor", "Assistant Manager", "Manager", "Senior Manager", "General Manager", "Director", "C-Level"}

var employeeSpec = importer.Spec{
	Entity: "hris.employees", FileName: "template-karyawan.csv",
	Columns: []importer.Column{
		{Key: "nama", Label: "Nama lengkap", Required: true},
		{Key: "email", Label: "Email", Required: true, Help: "Kunci unik karyawan"},
		{Key: "nip", Label: "NIP", Help: "Kosong = dibuat otomatis (EMP-<tahun>-NNNNN)"},
		{Key: "telepon", Label: "Telepon"},
		{Key: "tanggal_bergabung", Label: "Tanggal bergabung", Required: true, Help: "YYYY-MM-DD"},
		{Key: "status_kepegawaian", Label: "Status kepegawaian", Help: "Kode status (Master > Status Kepegawaian), default permanent"},
		{Key: "departemen", Label: "Departemen", Help: "Kode departemen"},
		{Key: "jabatan", Label: "Jabatan", Help: "Nama jabatan"},
		{Key: "atasan_email", Label: "Atasan (email)", Help: "Email karyawan yang menjadi atasan langsung; membentuk struktur organisasi"},
		{Key: "email_user", Label: "Email user", Help: "Email akun login yang ditautkan (Pengaturan > Manajemen User)"},
		{Key: "aktif", Label: "Aktif", Help: "ya atau tidak (default ya)"},
	},
	Sample: [][]string{
		{"Dewi Lestari", "dewi@nuhabit.id", "", "081234567890", "2025-01-06", "permanent", "OPS", "Gym Manager", "", "dewi@nuhabit.id", "ya"},
		{"Kevin Hartono", "kevin@nuhabit.id", "", "081234567891", "2025-02-03", "permanent", "OPS", "Head Coach", "dewi@nuhabit.id", "kevin@nuhabit.id", "ya"},
	},
}

// withCreate is withMenu for the create action of prefixes.
func (h handlers) withCreate(prefixes []string, fn func(w http.ResponseWriter, r *http.Request, u *auth.User) error) http.Handler {
	return handle(func(w http.ResponseWriter, r *http.Request) error {
		u, _, err := h.auth.RequireAnyGrant(r, iam.Can("create", prefixes))
		if err != nil {
			return err
		}
		return fn(w, r, u)
	})
}

func (h handlers) importRoutes() []module.Route {
	template := func(spec importer.Spec) func(w http.ResponseWriter, _ *http.Request, _ *auth.User) error {
		return func(w http.ResponseWriter, _ *http.Request, _ *auth.User) error {
			return importer.WriteTemplate(w, spec)
		}
	}
	return []module.Route{
		{Pattern: "GET /api/master/departments/import/template", Handler: h.withCreate(iam.HrisMaster, template(departmentSpec))},
		{Pattern: "POST /api/master/departments/import", Handler: h.withCreate(iam.HrisMaster, h.runImport(departmentSpec, (*Service).importDepartment))},
		{Pattern: "GET /api/master/positions/import/template", Handler: h.withCreate(iam.HrisMaster, template(positionSpec))},
		{Pattern: "POST /api/master/positions/import", Handler: h.withCreate(iam.HrisMaster, h.runImport(positionSpec, (*Service).importPosition))},
		{Pattern: "GET /api/hris/employees/import/template", Handler: h.withCreate(employeeRecordManagers, template(employeeSpec))},
		{Pattern: "POST /api/hris/employees/import", Handler: h.withCreate(employeeRecordManagers, h.runImport(employeeSpec, (*Service).importEmployee))},
	}
}

// rowImporter applies one row with a service bound to the row's transaction.
type rowImporter func(s *Service, ctx context.Context, row importer.Row) (importer.Result, error)

func (h handlers) runImport(spec importer.Spec, fn rowImporter) func(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	return func(w http.ResponseWriter, r *http.Request, u *auth.User) error {
		up, err := importer.Read(r, spec)
		if err != nil {
			return err
		}
		opts := importer.Options{DryRun: up.DryRun, Entity: spec.Entity, ActorID: u.ID, ActorName: u.FullName, Request: r, Log: h.svc.log}
		db, _ := h.svc.repo.querier().(database.DB)
		report, err := importer.Run(r.Context(), db, opts, up.Rows, func(ctx context.Context, tx pgx.Tx, row importer.Row) (importer.Result, error) {
			return fn(h.svc.withRepo(newStore(tx)), ctx, row)
		})
		if err != nil {
			return err
		}
		return httpx.OK(w, report)
	}
}

// withRepo is the service on another repository (a transaction).
func (s *Service) withRepo(repo Repository) *Service {
	c := *s
	c.repo = repo
	return &c
}

func (s *Service) importDepartment(ctx context.Context, row importer.Row) (importer.Result, error) {
	f := departmentSpec.Fields(row)
	in := masterInput{Code: strings.ToUpper(f.Text("kode", 40)), Name: f.Text("nama", 120)}
	if v := f.Text("deskripsi", 500); v != "" {
		in.Description = &v
	}
	active := f.Bool("aktif", true)
	in.IsActive = &active
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	res := importer.Result{Label: in.Code + " " + in.Name}
	row0, err := queryRow(ctx, s.repo.querier(), `SELECT id::text, name, code, description, is_active FROM hris.departments WHERE upper(code) = $1`, in.Code)
	if err != nil {
		return res, err
	}
	if row0 == nil {
		if _, err := s.SaveDepartment(ctx, nil, in); err != nil {
			return res, err
		}
		res.Status = importer.Created
		return res, nil
	}
	if row0.Str("name") == in.Name && sameText(row0.StrPtr("description"), in.Description) && row0.Bool("is_active") == active {
		res.Status = importer.Unchanged
		return res, nil
	}
	id := row0.Str("id")
	if _, err := s.SaveDepartment(ctx, &id, in); err != nil {
		return res, err
	}
	res.Status = importer.Updated
	return res, nil
}

func sameText(a, b *string) bool {
	return strOr(a) == strOr(b)
}

func (s *Service) importPosition(ctx context.Context, row importer.Row) (importer.Result, error) {
	f := positionSpec.Fields(row)
	in := masterInput{Title: f.Text("jabatan", 120)}
	if dept := f.Text("departemen", 120); dept != "" {
		name, err := departmentName(ctx, s.repo.querier(), dept)
		if err != nil {
			return importer.Result{}, err
		}
		if name == "" {
			f.Fail("departemen", "tidak ditemukan: "+dept)
		} else {
			in.Department = &name
		}
	}
	if v, ok := f.Enum("level", positionLevels); ok {
		in.Level = &v
	}
	active := f.Bool("aktif", true)
	in.IsActive = &active
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	res := importer.Result{Label: in.Title}
	row0, err := queryRow(ctx, s.repo.querier(), `SELECT id::text, department, level, is_active FROM hris.positions
		WHERE lower(title) = lower($1) ORDER BY is_active DESC, created_at LIMIT 1`, in.Title)
	if err != nil {
		return res, err
	}
	if row0 == nil {
		if _, err := s.SavePosition(ctx, nil, in); err != nil {
			return res, err
		}
		res.Status = importer.Created
		return res, nil
	}
	wantDept, wantLevel := "Operations", "Staff"
	if in.Department != nil {
		wantDept = *in.Department
	}
	if in.Level != nil {
		wantLevel = *in.Level
	}
	if row0.Str("department") == wantDept && row0.Str("level") == wantLevel && row0.Bool("is_active") == active {
		res.Status = importer.Unchanged
		return res, nil
	}
	id := row0.Str("id")
	if _, err := s.SavePosition(ctx, &id, in); err != nil {
		return res, err
	}
	res.Status = importer.Updated
	return res, nil
}

// departmentName resolves a department by code or name; "" when none.
func departmentName(ctx context.Context, q database.Querier, key string) (string, error) {
	var name string
	err := q.QueryRow(ctx, `SELECT name FROM hris.departments WHERE upper(code) = upper($1) OR lower(name) = lower($1)
		ORDER BY (upper(code) = upper($1)) DESC LIMIT 1`, key).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return name, err
}

func scalarText(ctx context.Context, q database.Querier, sql string, args ...any) (string, error) {
	var v string
	err := q.QueryRow(ctx, sql, args...).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func (s *Service) importEmployee(ctx context.Context, row importer.Row) (importer.Result, error) {
	f := employeeSpec.Fields(row)
	q := s.repo.querier()
	name := f.Text("nama", 255)
	email, _ := f.Email("email")
	nip := f.Text("nip", 50)
	phone := f.Text("telepon", 50)
	joinDate, _ := f.Date("tanggal_bergabung")
	status := strings.ToLower(f.Text("status_kepegawaian", 50))
	if status == "" {
		status = "permanent"
	} else {
		// The master list is optional data: once filled, the code must be one of its rows.
		var known bool
		if err := q.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM hris.employment_statuses)
			OR EXISTS (SELECT 1 FROM hris.employment_statuses WHERE lower(code) = $1)`, status).Scan(&known); err != nil {
			return importer.Result{}, err
		}
		if !known {
			f.Fail("status_kepegawaian", "tidak ditemukan: "+status)
		}
	}
	var departmentID, jobTitleID, reportingTo, userID *string
	if dept := f.Text("departemen", 120); dept != "" {
		id, err := scalarText(ctx, q, `SELECT id::text FROM hris.departments WHERE upper(code) = upper($1) OR lower(name) = lower($1)
			ORDER BY (upper(code) = upper($1)) DESC LIMIT 1`, dept)
		if err != nil {
			return importer.Result{}, err
		}
		if id == "" {
			f.Fail("departemen", "tidak ditemukan: "+dept)
		} else {
			departmentID = &id
		}
	}
	if title := f.Text("jabatan", 120); title != "" {
		id, err := scalarText(ctx, q, `SELECT id::text FROM hris.positions WHERE lower(title) = lower($1) ORDER BY is_active DESC, created_at LIMIT 1`, title)
		if err != nil {
			return importer.Result{}, err
		}
		if id == "" {
			f.Fail("jabatan", "tidak ditemukan: "+title)
		} else {
			jobTitleID = &id
		}
	}
	if boss, ok := f.Email("atasan_email"); ok {
		id, err := scalarText(ctx, q, `SELECT id::text FROM hris.employees WHERE lower(email) = $1 ORDER BY is_active DESC LIMIT 1`, boss)
		if err != nil {
			return importer.Result{}, err
		}
		switch {
		case id == "":
			f.Fail("atasan_email", "tidak ditemukan: "+boss+" (impor atasan lebih dulu)")
		case boss == email:
			f.Fail("atasan_email", "tidak boleh diri sendiri")
		default:
			reportingTo = &id
		}
	}
	if login, ok := f.Email("email_user"); ok {
		id, err := importer.StaffUserID(ctx, q, login)
		if err != nil {
			return importer.Result{}, err
		}
		if id == "" {
			f.Fail("email_user", "tidak cocok dengan akun mana pun: "+login)
		} else {
			userID = &id
		}
	}
	active := f.Bool("aktif", true)
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	res := importer.Result{Label: name + " <" + email + ">"}

	in := employeeInput{
		fullName: opt[string]{Val: &name, Sent: true}, email: opt[string]{Val: &email, Sent: true},
		phone: opt[string]{Val: &phone, Sent: true}, joinDate: opt[string]{Val: &joinDate, Sent: true},
		employmentStatus: opt[string]{Val: &status, Sent: true}, isActive: opt[bool]{Val: &active, Sent: true},
		departmentID: opt[string]{Val: departmentID, Sent: true}, jobTitleID: opt[string]{Val: jobTitleID, Sent: true},
		reportingTo: opt[string]{Val: reportingTo, Sent: true},
	}
	if nip != "" {
		in.nip = opt[string]{Val: &nip, Sent: true}
	}
	existing, err := queryRow(ctx, q, `SELECT id::text, full_name, nip, email, phone, join_date::text, employment_status, is_active,
			department_id::text, job_title_id::text, reporting_to::text, user_id::text
		FROM hris.employees WHERE lower(email) = $1 OR ($2 <> '' AND nip = $2) ORDER BY (lower(email) = $1) DESC LIMIT 1`, email, nip)
	if err != nil {
		return res, err
	}
	if existing == nil {
		created, err := s.CreateEmployee(ctx, in)
		if err != nil {
			return res, err
		}
		if userID != nil {
			if _, err := s.repo.UpdateEmployee(ctx, created.Str("id"), fields{{"user_id", *userID}}); err != nil {
				return res, err
			}
		}
		res.Status = importer.Created
		return res, nil
	}
	id := existing.Str("id")
	same := existing.Str("full_name") == name && existing.Str("email") == email && existing.Str("phone") == phone &&
		existing.Str("join_date") == joinDate && existing.Str("employment_status") == status && existing.Bool("is_active") == active &&
		sameText(existing.StrPtr("department_id"), departmentID) && sameText(existing.StrPtr("job_title_id"), jobTitleID) &&
		sameText(existing.StrPtr("reporting_to"), reportingTo) && (nip == "" || existing.Str("nip") == nip) &&
		(userID == nil || sameText(existing.StrPtr("user_id"), userID))
	if same {
		res.Status = importer.Unchanged
		return res, nil
	}
	// UpdateEmployee refuses to write the employee's own email or NIP back as
	// a duplicate only when another row holds it; its own values pass.
	if _, err := s.UpdateEmployee(ctx, id, in); err != nil {
		return res, err
	}
	if userID != nil {
		if _, err := s.repo.UpdateEmployee(ctx, id, fields{{"user_id", *userID}}); err != nil {
			return res, err
		}
	}
	res.Status = importer.Updated
	return res, nil
}
