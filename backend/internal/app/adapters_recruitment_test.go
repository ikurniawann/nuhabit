package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/recruitment"
	"nuhabit/backend/internal/platform/testutil"
)

// The promotion adapters run on a rolled-back transaction: the DB function
// creates the employee, then the adapters read it and draft its contract.
func TestRecruitmentPromotionAdapters(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	var candidateID, employeeID string
	if err := tx.QueryRow(ctx, `INSERT INTO recruitment.candidates (full_name, email, phone, domicile, source, status)
		VALUES ('Go Adapter', 'go' || md5(random()::text) || '@x.id', '0812', 'Jkt', 'walk_in', 'hired') RETURNING id::text`).Scan(&candidateID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT public.promote_candidate_to_employee($1, '2026-08-01', 'contract', NULL, NULL)::text`, candidateID).Scan(&employeeID); err != nil {
		t.Fatal(err)
	}

	row, err := recruitmentEmployees{}.Employee(ctx, tx, employeeID)
	if err != nil || row == nil {
		t.Fatalf("employee: %v", err)
	}
	if nip, _ := row.Get("nip").(string); !strings.HasPrefix(nip, "EMP-") || row.Get("department") != nil {
		t.Fatalf("nip %v department %v", row.Get("nip"), row.Get("department"))
	}

	now := func() time.Time { return time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC) }
	end, salary := "2027-08-01", "5000000"
	contracts := recruitmentContracts{now: now}
	number, rejection, err := contracts.CreateDraft(ctx, tx, recruitment.DraftContract{
		EmployeeID: employeeID, ContractType: "pkwt", StartDate: "2026-08-01", EndDate: &end,
		BaseSalary: &salary, Notes: "Draft otomatis saat promote kandidat.", CreatedByName: "Sistem (promote kandidat)",
	})
	if err != nil || rejection != "" || !strings.HasSuffix(number, "/PKWT/VII/2026") {
		t.Fatalf("draft: %q %q %v", number, rejection, err)
	}
	var status, base string
	if err := tx.QueryRow(ctx, `SELECT status, base_salary::text FROM hris.employment_contracts WHERE contract_number = $1`, number).Scan(&status, &base); err != nil {
		t.Fatal(err)
	}
	if status != "draft" || base != "5000000.00" {
		t.Fatalf("%s %s", status, base)
	}

	// compliance rejections come back as messages
	if _, rejection, _ := contracts.CreateDraft(ctx, tx, recruitment.DraftContract{EmployeeID: employeeID, ContractType: "pkwt", StartDate: "2026-08-01"}); rejection != "PKWT wajib memiliki tanggal berakhir (perjanjian waktu tertentu)." {
		t.Fatal(rejection)
	}
	if _, rejection, _ := contracts.CreateDraft(ctx, tx, recruitment.DraftContract{EmployeeID: "11111111-1111-4111-8111-111111111111", ContractType: "pkwtt", StartDate: "2026-08-01"}); rejection != "Karyawan tidak ditemukan" {
		t.Fatal(rejection)
	}
	if got := monthsWorked("2026-01-15", "2026-03-01"); got != 1.53 {
		t.Fatal(got)
	}
}
