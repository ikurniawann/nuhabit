package procurement

import "testing"

// Ported from the supplier part of frontend/src/lib/purchasing/import-rules.test.ts.

func TestSupplierImportRules(t *testing.T) {
	for in, want := range map[string]string{"cash": "CBD", "": "TOP30", "weird": "TOP30", "top 14": "TOP14"} {
		if got := normalizePaymentTerms(in); got != want {
			t.Errorf("normalizePaymentTerms(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{"usd": "USD", "xyz": "IDR"} {
		if got := normalizeCurrency(in); got != want {
			t.Errorf("normalizeCurrency(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{"Blocked": "blocked", "0": "inactive", "aktif": "active", "": "active"} {
		if got := normalizeSupplierStatus(in); got != want {
			t.Errorf("normalizeSupplierStatus(%q) = %q, want %q", in, got, want)
		}
	}

	f := setSupplierPayload(&fields{}, map[string]string{"status": "blocked", "email": " "}, "Toko A")
	got := map[string]any{}
	for i, c := range f.cols {
		got[c] = f.vals[i]
	}
	if got["nama_supplier"] != "Toko A" || got["email"].(*string) != nil || got["status"] != "blocked" || got["is_active"] != false ||
		got["payment_terms"] != "TOP30" || got["currency"] != "IDR" {
		t.Fatalf("payload = %v", got)
	}
	for in, want := range map[string]int{"SUP-2026-0007": 8, "": 1, "SUP-2026-x": 1} {
		if got := nextCodeSequence(in); got != want {
			t.Errorf("nextCodeSequence(%q) = %d, want %d", in, got, want)
		}
	}
}
