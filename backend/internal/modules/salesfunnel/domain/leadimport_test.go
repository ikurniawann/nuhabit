package domain

import "testing"

// lib/sales-funnel/lead-import.test.ts

var importHeaders = []string{"nama_instansi", "jenis_instansi", "nama_pic", "wa_pic", "email_pic", "sumber", "suhu", "kota", "catatan"}

func TestMapLeadImportRow(t *testing.T) {
	eq(t, MapLeadImportRow(importHeaders, []string{"", " ", ""}), LeadImportRowResult{Kind: LeadRowEmpty})
	eq(t, MapLeadImportRow(importHeaders, []string{"PT A", "", "", "0812"}),
		LeadImportRowResult{Kind: LeadRowInvalid, Message: "Field wajib kosong: nama_instansi / nama_pic / wa_pic"})
	eq(t, MapLeadImportRow(importHeaders, []string{"PT A", "", "Budi", "0812"}),
		LeadImportRowResult{Kind: LeadRowInvalid, Message: "No. WA tidak valid: 0812"})
	eq(t, MapLeadImportRow(importHeaders, []string{"PT A", "", "Budi", "0812-3456-7890"}).Lead.PicPhone, "6281234567890")

	eq(t, MapLeadImportRow(importHeaders, []string{"PT A", "UNIVERSITAS", "Budi", "081234567890", "budi@", "TikTok", "PANAS", " Bandung ", ""}),
		LeadImportRowResult{Kind: LeadRowOK, RawPhone: "081234567890", Warning: "Email diabaikan (tidak valid): budi@",
			Lead: LeadImportRow{OrgName: "PT A", OrgType: "corporate", PicName: "Budi", PicPhone: "6281234567890",
				City: ptr("Bandung"), Source: "lainnya", Temperature: "panas"}})

	ok := MapLeadImportRow(importHeaders, []string{"PT A", "Sekolah", "Budi", "081234567890", "budi@x.id", "wa", "", "", " catatan "})
	eq(t, ok.Lead.PicEmail, ptr("budi@x.id"))
	eq(t, ok.Lead.OrgType, "sekolah")
	eq(t, ok.Lead.Source, "wa")
	eq(t, ok.Lead.Temperature, "hangat")
	eq(t, ok.Lead.Notes, ptr("catatan"))
	eq(t, ok.Warning, "")
	// JavaScript's \S rejects a no-break space inside the address.
	eq(t, MapLeadImportRow(importHeaders, []string{"PT A", "", "Budi", "081234567890", "budi x@y.id"}).Warning,
		"Email diabaikan (tidak valid): budi x@y.id")
}

func TestLeadDedupKey(t *testing.T) {
	eq(t, LeadDedupKey("6281", " PT Maju "), LeadDedupKey("6281", "pt maju"))
	if LeadDedupKey("6281", "PT Maju") == LeadDedupKey("6282", "PT Maju") {
		t.Fatal("the number is part of the key")
	}
}

func TestNormalizeLeadHeader(t *testing.T) {
	for in, want := range map[string]string{"Nama Instansi": "nama_instansi", "No WA": "wa_pic", "Email": "email_pic", "Kota": "kota", "Keterangan": "catatan"} {
		eq(t, NormalizeLeadHeader(in), want)
	}
}
