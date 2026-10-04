package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/memberportal"
	"nuhabit/backend/internal/platform/testutil"
)

// The portal's XP goes through the CRM engine: top-up XP is multiplied by
// the member's tier (gold, xp_multiplier 1.5) as loyalty-ledger.ts does,
// while flat awards (profile, challenge, badge) stay nominal.
func TestMemberLoyaltyAppliesTierMultiplier(t *testing.T) {
	deps := testutil.Deps(t, nil)
	member := testutil.CreateMember(t)
	tx := testutil.Tx(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE pos.pos_loyalty_settings SET topup_xp_enabled = true, topup_xp_mode = 'fixed', topup_xp_value = 10 WHERE is_active`)
	exec(`INSERT INTO crm.crm_member_profiles (customer_id, tier_id)
		SELECT $1, id FROM crm.crm_membership_tiers WHERE code = 'gold' AND xp_multiplier = 1.5`, member.CustomerID)

	l := memberLoyalty{engine: crm.NewEngine(deps, crmPosReads{}), db: tx}
	topup, err := l.AwardTopupXP(ctx, member.CustomerID, 50000, "6f1e2d3c-4b5a-4c6d-8e7f-"+testutil.RandomHex(6))
	if err != nil || topup.Status != "posted" || topup.XPAwarded != 15 {
		t.Fatalf("topup XP %+v %v", topup, err)
	}
	flat, err := l.AwardFlatXP(ctx, memberportal.XPAward{
		CustomerID: member.CustomerID, XPAmount: 10, SourceType: "challenge", SourceID: member.CustomerID,
		ReferenceTable: "challenges", IdempotencyKey: "challenge:go-test:" + member.CustomerID, Description: "Hadiah challenge: Go",
	})
	if err != nil || flat.Status != "posted" || flat.XPAwarded != 10 {
		t.Fatalf("flat XP %+v %v", flat, err)
	}
}
