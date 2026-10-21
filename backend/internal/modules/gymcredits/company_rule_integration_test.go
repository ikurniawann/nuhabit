package gymcredits

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/testutil"
)

func TestDefaultCompanyRule(t *testing.T) {
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	c := e.member.CustomerID
	pkg := e.pkg("Go Default", 2, 200_000, 30, nil)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 1000000 WHERE id = $1`, c)

	// Several companies, no branch anywhere: the sale has no company.
	testutil.CreateOrg(t, e.tx)
	first, err := e.svc.BuyWithArk(e.ctx, MemberPurchase{CustomerID: c, PackageID: pkg})
	if err != nil {
		t.Fatal(err)
	}
	if j := e.journals(first.ID)["GYM_SALE_ARK_COIN"]; j.CompanyID != nil {
		t.Fatalf("sale without a company booked to %v", *j.CompanyID)
	}

	// The global rule names the company every such sale books to.
	e.exec(`DELETE FROM gym.business_rules WHERE branch_id IS NULL`)
	e.exec(`INSERT INTO gym.business_rules (branch_id, rules) VALUES (NULL, jsonb_build_object('defaultCompanyId', $1::text))`, org.CompanyID)
	second, err := e.svc.BuyWithArk(e.ctx, MemberPurchase{CustomerID: c, PackageID: pkg})
	if err != nil {
		t.Fatal(err)
	}
	if j := e.journals(second.ID)["GYM_SALE_ARK_COIN"]; j.CompanyID == nil || *j.CompanyID != org.CompanyID {
		t.Fatalf("sale journal %+v", j)
	}
	view, err := e.svc.RulesAdmin(e.ctx)
	if err != nil || view.Global.DefaultCompanyID != org.CompanyID || len(view.Companies) == 0 {
		t.Fatalf("rules admin %+v %v", view, err)
	}
	if msg, err := e.svc.SaveRules(e.ctx, &org.BranchID, []domain.KV{{Key: "defaultCompanyId", Value: org.CompanyID}}, e.staff.UserID); err != nil || !strings.Contains(msg, "aturan global") {
		t.Fatalf("branch override of the company: %q %v", msg, err)
	}
}
