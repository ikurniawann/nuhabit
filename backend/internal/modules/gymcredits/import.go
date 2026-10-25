package gymcredits

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/importer"
	"nuhabit/backend/internal/platform/localtime"
)

// CSV/XLSX import of membership packages, keyed by name, through the same
// save path as the package form. Also the opening balances the member
// import (gym-desk) writes: a starting credit lot and a running pass.
// See backend/docs/DATA_SETUP.md.

var packageSpec = importer.Spec{
	Entity: "gym.credit_packages", FileName: "template-paket.csv",
	Columns: []importer.Column{
		{Key: "nama", Label: "Nama", Required: true, Help: "Nama paket, kunci unik (2-120 karakter)"},
		{Key: "jenis", Label: "Jenis", Help: "credits (paket kredit) atau pass (booking tanpa batas); default credits"},
		{Key: "kredit", Label: "Kredit", Help: "Jumlah kredit paket credits (1-1000); kosong untuk pass"},
		{Key: "masa_berlaku_hari", Label: "Masa berlaku (hari)", Required: true, Help: "1-3650 hari sejak pembelian"},
		{Key: "harga", Label: "Harga", Required: true, Help: "Harga dasar dalam rupiah"},
		{Key: "harga_cabang", Label: "Harga cabang", Help: "KODE=harga dipisah titik koma, misalnya DAGO=1200000;SNP=1300000"},
		{Key: "cabang", Label: "Cabang", Help: "Kode cabang bila paket hanya dijual di satu cabang"},
		{Key: "jenis_kelas", Label: "Jenis kelas", Help: "Nama jenis kelas yang boleh dibayar, dipisah titik koma; kosong = semua"},
		{Key: "termasuk_pt", Label: "Termasuk PT", Help: "ya bila pass juga membayar sesi PT (hanya pass)"},
		{Key: "publik", Label: "Publik", Help: "ya bila tampil di aplikasi member dan situs (default ya)"},
		{Key: "batas_beli_per_member", Label: "Batas beli per member", Help: "Kosong = tanpa batas"},
		{Key: "badge", Label: "Badge", Help: "Label singkat di katalog, misalnya Paling laris"},
		{Key: "deskripsi", Label: "Deskripsi", Help: "Maksimal 1000 karakter"},
		{Key: "urutan", Label: "Urutan", Help: "Urutan tampil (0-10000)"},
	},
	Sample: [][]string{
		{"Starter 5", "credits", "5", "60", "800000", "", "", "", "", "ya", "", "", "Lima kredit untuk mulai rutin latihan.", "20"},
		{"Pass 4 Minggu", "pass", "", "28", "1200000", "DAGO=1200000;SNP=1350000", "", "", "tidak", "ya", "", "", "Booking kelas tanpa batas selama 4 minggu.", "110"},
		{"PT 10 Sesi", "credits", "10", "120", "4000000", "", "", "Personal Training", "", "tidak", "", "", "Sepuluh sesi personal training.", "61"},
	},
}

func (h *Handler) packageTemplate(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.require(r, actCreate, iam.GymPackages); err != nil {
		return err
	}
	return importer.WriteTemplate(w, packageSpec)
}

func (h *Handler) importPackages(w http.ResponseWriter, r *http.Request) error {
	user, err := h.require(r, actCreate, iam.GymPackages)
	if err != nil {
		return err
	}
	up, err := importer.Read(r, packageSpec)
	if err != nil {
		return err
	}
	opts := importer.Options{DryRun: up.DryRun, Entity: packageSpec.Entity, ActorID: user.ID, ActorName: user.FullName, Request: r, Log: h.svc.log}
	report, err := importer.Run(r.Context(), h.svc.db, opts, up.Rows, func(ctx context.Context, tx pgx.Tx, row importer.Row) (importer.Result, error) {
		res, err := h.svc.importPackage(ctx, tx, row, user.ID)
		return res, asHTTP(err)
	})
	if err != nil {
		return err
	}
	return httpx.OK(w, report)
}

// storedPackage is the package row the import compares against.
type storedPackage struct {
	ID string
	PackageInput
}

func (s *Service) packageByName(ctx context.Context, q database.Querier, name string) (*storedPackage, error) {
	var p storedPackage
	var classTypes []string
	err := q.QueryRow(ctx, `SELECT id::text, name, description, kind, credits, price_idr::float8, validity_days,
			purchase_limit_per_member, COALESCE(applicable_class_type_ids::text[], '{}'), branch_id::text, is_public, badge, covers_personal, sort_order
		FROM gym.credit_packages WHERE lower(name) = lower($1) ORDER BY (status = 'active') DESC, created_at LIMIT 1`, name).
		Scan(&p.ID, &p.Name, &p.Description, &p.Kind, &p.Credits, &p.PriceIdr, &p.ValidityDays, &p.PurchaseLimitPerMember,
			&classTypes, &p.BranchID, &p.IsPublic, &p.Badge, &p.CoversPersonal, &p.SortOrder)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.ApplicableClassTypeIDs = classTypes
	rows, err := q.Query(ctx, `SELECT branch_id::text, price_idr::float8 FROM gym.package_branch_prices WHERE package_id = $1 ORDER BY branch_id`, p.ID)
	if err != nil {
		return nil, err
	}
	p.BranchPrices, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (BranchPrice, error) {
		var bp BranchPrice
		err := r.Scan(&bp.BranchID, &bp.PriceIdr)
		return bp, err
	})
	return &p, err
}

func (s *Service) importPackage(ctx context.Context, tx pgx.Tx, row importer.Row, actorID string) (importer.Result, error) {
	f := packageSpec.Fields(row)
	p := PackageInput{Name: f.Text("nama", 120), Description: f.Text("deskripsi", 1000), Kind: KindCredits, IsPublic: f.Bool("publik", true)}
	if len([]rune(p.Name)) < 2 && p.Name != "" {
		f.Fail("nama", "minimal 2 karakter")
	}
	if v, ok := f.Enum("jenis", packageKinds); ok {
		p.Kind = v
	}
	if p.Kind == KindPass {
		if f.Raw("kredit") != "" && f.Raw("kredit") != "0" {
			f.Fail("kredit", "harus kosong untuk pass")
		}
		p.CoversPersonal = f.Bool("termasuk_pt", false)
	} else if v, ok := f.Int("kredit", 1, 1000); ok {
		p.Credits = v
	} else if f.Raw("kredit") == "" {
		f.Fail("kredit", "wajib diisi untuk paket credits")
	}
	p.ValidityDays, _ = f.Int("masa_berlaku_hari", 1, 3650)
	p.PriceIdr, _ = f.Money("harga")
	if v, ok := f.Int("batas_beli_per_member", 1, 1000); ok {
		p.PurchaseLimitPerMember = &v
	}
	if v := f.Text("badge", 40); v != "" {
		p.Badge = &v
	}
	p.SortOrder, _ = f.Int("urutan", 0, 10_000)
	if code := f.Text("cabang", 80); code != "" {
		id, err := importer.BranchID(ctx, tx, code)
		if err != nil {
			return importer.Result{}, err
		}
		if id == "" {
			f.Fail("cabang", "tidak ditemukan: "+code)
		} else {
			p.BranchID = &id
		}
	}
	if raw := f.Raw("harga_cabang"); raw != "" {
		pairs, ok := importer.ParsePairs(raw)
		if !ok {
			f.Fail("harga_cabang", "harus KODE=harga dipisah titik koma")
		}
		for _, pair := range pairs {
			id, err := importer.BranchID(ctx, tx, pair.Key)
			if err != nil {
				return importer.Result{}, err
			}
			price, priceOK := importer.ParseMoney(pair.Value)
			switch {
			case id == "":
				f.Fail("harga_cabang", "cabang tidak ditemukan: "+pair.Key)
			case !priceOK || price < 0:
				f.Fail("harga_cabang", "harga tidak valid untuk "+pair.Key)
			default:
				p.BranchPrices = append(p.BranchPrices, BranchPrice{BranchID: id, PriceIdr: price})
			}
		}
	}
	if raw := f.Raw("jenis_kelas"); raw != "" {
		classTypes, err := s.ports.Directory.ActiveClassTypes(ctx, tx)
		if err != nil {
			return importer.Result{}, err
		}
		for _, name := range importer.SplitList(raw) {
			i := slices.IndexFunc(classTypes, func(c ClassType) bool { return strings.EqualFold(c.Name, name) })
			if i < 0 {
				f.Fail("jenis_kelas", "tidak ditemukan: "+name)
				continue
			}
			p.ApplicableClassTypeIDs = append(p.ApplicableClassTypeIDs, classTypes[i].ID)
		}
		slices.Sort(p.ApplicableClassTypeIDs)
	}
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	res := importer.Result{Label: p.Name}
	stored, err := s.packageByName(ctx, tx, p.Name)
	if err != nil {
		return res, err
	}
	if stored != nil {
		if samePackage(stored.PackageInput, p) {
			res.Status = importer.Unchanged
			return res, nil
		}
		p.ID = &stored.ID
	}
	id, err := s.repo.SavePackage(ctx, tx, p, actorID)
	if err != nil {
		return res, err
	}
	if id == "" {
		return res, importer.Reject("Paket tidak ditemukan")
	}
	if err := s.repo.ReplaceBranchPrices(ctx, tx, id, p.BranchPrices); err != nil {
		return res, err
	}
	res.Status = importer.Created
	if stored != nil {
		res.Status = importer.Updated
	}
	return res, nil
}

// samePackage reports whether saving b over a would change nothing.
func samePackage(a, b PackageInput) bool {
	sameStr := func(x, y *string) bool { return (x == nil && y == nil) || (x != nil && y != nil && *x == *y) }
	sameInt := func(x, y *int) bool { return (x == nil && y == nil) || (x != nil && y != nil && *x == *y) }
	classTypes := slices.Clone(a.ApplicableClassTypeIDs)
	slices.Sort(classTypes)
	prices := slices.Clone(b.BranchPrices)
	slices.SortFunc(prices, func(x, y BranchPrice) int { return strings.Compare(x.BranchID, y.BranchID) })
	return a.Name == b.Name && a.Description == b.Description && a.Kind == b.Kind && a.Credits == b.Credits &&
		a.PriceIdr == b.PriceIdr && a.ValidityDays == b.ValidityDays && sameInt(a.PurchaseLimitPerMember, b.PurchaseLimitPerMember) &&
		slices.Equal(classTypes, b.ApplicableClassTypeIDs) && sameStr(a.BranchID, b.BranchID) && a.IsPublic == b.IsPublic &&
		sameStr(a.Badge, b.Badge) && a.CoversPersonal == b.CoversPersonal && a.SortOrder == b.SortOrder &&
		slices.Equal(a.BranchPrices, prices)
}

/* ── Opening balances for the member import ─────────────────────────── */

// OpeningCredits grants a member's starting balance as an adjustment lot,
// once: the entry carries an idempotency key per member, so a second
// import of the same member returns created false. expiresOn (YYYY-MM-DD,
// end of day in Jakarta) overrides the creditExpiryDays rule.
func (s *Service) OpeningCredits(ctx context.Context, q database.Querier, customerID string, credits int, expiresOn, note, actorID string) (bool, error) {
	if credits <= 0 || credits > 1000 {
		return false, fail(http.StatusBadRequest, "Saldo awal harus 1-1000 kredit")
	}
	now := s.clock()
	var expiresAt time.Time
	if expiresOn != "" {
		day, err := localtime.ParseDay(expiresOn, localtime.Jakarta)
		if err != nil {
			return false, fail(http.StatusBadRequest, "Tanggal kedaluwarsa kredit harus YYYY-MM-DD")
		}
		expiresAt = day.Add(24 * time.Hour)
		if !expiresAt.After(now) {
			return false, fail(http.StatusBadRequest, "Tanggal kedaluwarsa kredit sudah lewat")
		}
	} else {
		rules, err := s.Rules(ctx, q, nil)
		if err != nil {
			return false, err
		}
		expiresAt = domain.LotExpiry(now, rules.CreditExpiryDays)
	}
	entryID, _, err := s.GrantCredits(ctx, q, Grant{
		CustomerID: customerID, Type: domain.Adjustment, Credits: credits, ExpiresAt: expiresAt,
		SourceType: "admin", Note: note, IdempotencyKey: "opening:" + customerID, CreatedBy: actorID,
	})
	return entryID != "", err
}

// OpeningPass gives a member a running pass of the named pass package that
// ends at endsOn (YYYY-MM-DD, end of day in Jakarta), without a purchase.
// A member who already holds a live pass keeps it (created false).
func (s *Service) OpeningPass(ctx context.Context, q database.Querier, customerID, packageName, endsOn string) (bool, error) {
	var packageID string
	err := q.QueryRow(ctx, `SELECT id::text FROM gym.credit_packages WHERE kind = 'pass' AND lower(name) = lower($1)
		ORDER BY (status = 'active') DESC, created_at LIMIT 1`, packageName).Scan(&packageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, fail(http.StatusBadRequest, "Paket pass tidak ditemukan: "+packageName)
	}
	if err != nil {
		return false, err
	}
	day, err := localtime.ParseDay(endsOn, localtime.Jakarta)
	if err != nil {
		return false, fail(http.StatusBadRequest, "Tanggal akhir pass harus YYYY-MM-DD")
	}
	now := s.clock()
	endsAt := day.Add(24 * time.Hour)
	if !endsAt.After(now) {
		return false, fail(http.StatusBadRequest, "Tanggal akhir pass sudah lewat")
	}
	if err := s.repo.LockMemberCredits(ctx, q, customerID); err != nil {
		return false, err
	}
	var live bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.member_passes
		WHERE customer_id = $1 AND status IN ('active', 'frozen') AND ends_at > $2)`, customerID, now).Scan(&live); err != nil {
		return false, err
	}
	if live {
		return false, nil
	}
	id, err := s.repo.InsertPass(ctx, q, NewPass{CustomerID: customerID, PackageID: packageID, StartsAt: now, EndsAt: endsAt, RenewWith: RenewWithInvoice})
	return id != "", err
}
