package iam

import (
	"bytes"
	"os"
	"testing"

	"nuhabit/backend/internal/platform/iam/iamgen"
)

const prefixesTS = "../../../../frontend/src/lib/iam/prefixes.ts"

// TestGeneratedMatchesTS fails when prefixes.ts changed and
// prefixes_gen.go was not regenerated (go generate ./internal/platform/iam).
func TestGeneratedMatchesTS(t *testing.T) {
	raw, err := os.ReadFile(prefixesTS)
	if err != nil {
		t.Skipf("frontend source not available: %v", err)
	}
	entries, err := iamgen.Parse(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	want, err := iamgen.Render(entries)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile("prefixes_gen.go")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("prefixes_gen.go is stale: run `go generate ./internal/platform/iam` from backend/")
	}
	if len(ByKey) != len(entries) {
		t.Fatalf("ByKey has %d keys, prefixes.ts has %d", len(ByKey), len(entries))
	}
}

func TestPrefixesSample(t *testing.T) {
	if len(GymPackages) != 1 || GymPackages[0] != "gym.packages" {
		t.Fatalf("GymPackages = %v", GymPackages)
	}
	if len(GymScheduling) != 5 {
		t.Fatalf("GymScheduling = %v", GymScheduling)
	}
}

// Ports frontend/src/lib/iam/prefixes.test.ts and has-menu.test.ts matchers.
func TestMatchers(t *testing.T) {
	if !HasAnyMenuPrefix([]string{"pos.operations.cashier"}, PosOperations) {
		t.Error("a cashier menu satisfies POS operations")
	}
	if HasAnyMenuPrefix([]string{"ess.attendance"}, Items) {
		t.Error("ESS must not satisfy items")
	}
	if HasAnyMenuPrefix([]string{"items.productx"}, []string{"items.product"}) {
		t.Error("prefix must match whole segments")
	}
	if !HasAnyMenuPrefix([]string{"items.product"}, []string{"items.product"}) {
		t.Error("exact code matches")
	}
	granted := map[string][]string{
		"items.product.master": {"read", "create"},
		"pos.catalog":          {"read"},
	}
	if !HasGrantedAction(granted, []string{"items.product"}, "create") {
		t.Error("create granted under items.product")
	}
	if HasGrantedAction(granted, []string{"pos"}, "create") {
		t.Error("pos has read only")
	}
	if !HasMenuCode([]string{"a", "b"}, "b") || HasMenuCode([]string{"a"}, "a.b") {
		t.Error("HasMenuCode is exact")
	}
}
