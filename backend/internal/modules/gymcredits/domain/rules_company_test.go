package domain

import "testing"

func TestDefaultCompanyRule(t *testing.T) {
	const company = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
	rules, msg := ValidateRules(with(defaultsKV(), "defaultCompanyId", company))
	eq(t, msg, "")
	eq(t, rules.DefaultCompanyID, company)
	_, msg = ValidateRules(with(defaultsKV(), "defaultCompanyId", "acme"))
	eq(t, msg, "defaultCompanyId: Perusahaan default harus id perusahaan atau kosong")
	_, msg = ValidateRules(with(defaultsKV(), "defaultCompanyId", 7.0))
	eq(t, msg, "defaultCompanyId: Perusahaan default harus id perusahaan atau kosong")

	// A branch cannot override the company.
	_, msg = ValidateRulesPatch([]KV{{"defaultCompanyId", company}})
	eq(t, msg, "defaultCompanyId: Perusahaan default hanya berlaku di aturan global")
	p, msg := ValidateRulesPatch([]KV{{"maxBookingsPerDay", 2.0}})
	eq(t, msg, "")
	if p.DefaultCompanyID != nil {
		t.Fatal("a patch without the key must not set it")
	}

	// Stored values resolve like every other key; a bad one is ignored.
	eq(t, ResolveRules(map[string]any{"defaultCompanyId": company}, nil).DefaultCompanyID, company)
	eq(t, ResolveRules(map[string]any{"defaultCompanyId": "nope"}, nil).DefaultCompanyID, "")
	eq(t, ResolveRules(map[string]any{"defaultCompanyId": company}, map[string]any{"defaultCompanyId": ""}).DefaultCompanyID, "")
}
