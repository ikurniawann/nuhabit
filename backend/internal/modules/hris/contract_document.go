package hris

import (
	"context"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/pdfgen"
)

// Employment contract documents: the PKWT/PKWTT agreement generated on the
// fly (lib/hris/contract-pdf.ts) and the signed scan kept in private
// storage (contracts-repo saveSignedDocument/removeSignedDocument).

// MaxSignedDocumentBytes is MAX_SIGNED_DOCUMENT_BYTES.
const MaxSignedDocumentBytes = 10 * 1024 * 1024

var companySettingKeys = []string{"company_legal_name", "company_address", "company_city",
	"company_signer_name", "company_signer_title"}

// ContractPDF is loadContractDocument + buildContractPdf; it returns the
// PDF and its download name.
func (s *Service) ContractPDF(ctx context.Context, id string) ([]byte, string, error) {
	row, err := s.repo.ContractDocument(ctx, id)
	if err != nil {
		return nil, "", err
	}
	if row == nil {
		return nil, "", httpx.NotFound("Kontrak tidak ditemukan")
	}
	settings, err := s.company.GetMany(ctx, s.repo.querier(), companySettingKeys)
	if err != nil {
		return nil, "", err
	}
	pdf, err := buildContractPDF(settings, row)
	return pdf, domain.ContractFileName(row.Str("contract_number"), row.Str("full_name")), err
}

// SaveSignedDocument stores a scan (PDF/JPG/PNG/WebP by content) and
// replaces the previous file.
func (s *Service) SaveSignedDocument(ctx context.Context, c *signedContract, data []byte) error {
	path, err := s.files.SavePrivateDocument(data, "contract-signed/"+c.EmployeeID)
	if err != nil {
		return httpx.BadRequest(err.Error())
	}
	if err := s.repo.SetSignedDocument(ctx, c.ID, &path); err != nil {
		return err
	}
	if c.SignedDocumentURL != nil {
		s.files.DeletePrivate(*c.SignedDocumentURL)
	}
	return nil
}

// RemoveSignedDocument clears the column and deletes the file.
func (s *Service) RemoveSignedDocument(ctx context.Context, c *signedContract) error {
	if c.SignedDocumentURL == nil {
		return httpx.Conflict("Kontrak ini belum punya dokumen bertanda tangan")
	}
	if err := s.repo.SetSignedDocument(ctx, c.ID, nil); err != nil {
		return err
	}
	s.files.DeletePrivate(*c.SignedDocumentURL)
	return nil
}

/* ── PDF ─────────────────────────────────────────────────────────────── */

const blank = "____________________"

// val is val(): the value, or a fill-in line when empty or blank.
func val(s *string) string {
	if s == nil || domain.JSTrim(*s) == "" {
		return blank
	}
	return *s
}

// dateID is formatDateId: "1 Agustus 2026", a fill-in line when missing.
func dateID(s *string) string {
	if s == nil {
		return blank
	}
	if out, ok := domain.LongDateID(*s); ok {
		return out
	}
	return blank
}

// idr is formatIdr: "Rp 4.500.000,- (empat juta lima ratus ribu rupiah)".
func idr(raw *string) string {
	if raw == nil || *raw == "" {
		return blank
	}
	v := domain.JSNumber(*raw)
	if !domain.IsFinite(v) || v <= 0 {
		return blank
	}
	return "Rp " + pdfgen.Thousands(v) + ",- (" + pdfgen.Terbilang(v) + ")"
}

// contractWriter lays the agreement out like the pdfkit flow: justified
// paragraphs at the margin with 2.5pt line gaps, centered article headings.
type contractWriter struct{ d *pdfgen.Doc }

// justified is doc.text(text, { align: "justify", lineGap: 2.5 }).
func (w contractWriter) justified(text string) {
	w.d.Para(text, pdfgen.TextOpts{Align: pdfgen.AlignJustify, LineGap: 2.5})
}

// aligned is doc.text(text, { align }) for headings and the signing place.
func (w contractWriter) aligned(text string, align pdfgen.Align) {
	w.d.Para(text, pdfgen.TextOpts{Align: align})
}

func (w contractWriter) para(text string) {
	w.d.Font(pdfgen.Helvetica, 10).Color("#111827")
	w.justified(text)
	w.d.MoveDown(0.3)
}

func (w contractWriter) pasal(n int, title string) {
	w.d.MoveDown(0.9)
	w.d.Font(pdfgen.HelveticaBold, 10.5)
	w.aligned("PASAL "+strconv.Itoa(n), pdfgen.AlignCenter)
	w.aligned(strings.ToUpper(title), pdfgen.AlignCenter)
	w.d.MoveDown(0.35)
	w.d.Font(pdfgen.Helvetica, 10)
}

func (w contractWriter) numbered(items ...string) {
	for i, item := range items {
		w.d.Font(pdfgen.Helvetica, 10)
		w.justified(strconv.Itoa(i+1) + ". " + item)
		w.d.MoveDown(0.2)
	}
	w.d.MoveDown(0.1)
}

func (w contractWriter) party(label, value string) {
	d := w.d
	x, labelW := d.Left()+16, 130.0
	y := d.Y
	d.Font(pdfgen.Helvetica, 10)
	yl := d.Text(label, x, y, pdfgen.TextOpts{Width: labelW})
	yv := d.Text(": "+value, x+labelW, y, pdfgen.TextOpts{Width: d.Right() - x - labelW})
	d.X, d.Y = d.Left(), max(yl, yv)
	d.MoveDown(0.15)
}

// buildContractPDF is buildContractPdf (A4, 56pt margins) from the company
// settings and the contract row joined with its employee.
func buildContractPDF(co map[string]*string, c *Row) ([]byte, error) {
	d := pdfgen.New(pdfgen.Options{Size: "A4", Margin: 56})
	w := contractWriter{d}
	emp := c
	isPkwt := c.Str("contract_type") == "pkwt"
	judul := "PERJANJIAN KERJA WAKTU TIDAK TERTENTU (PKWTT)"
	if isPkwt {
		judul = "PERJANJIAN KERJA WAKTU TERTENTU (PKWT)"
	}
	signedOn := c.StrPtr("signed_at")
	if signedOn == nil {
		signedOn = c.StrPtr("start_date")
	}
	tanggalTtd := dateID(signedOn)
	city := val(co["company_city"])

	d.Font(pdfgen.HelveticaBold, 13).Color("#111827")
	w.aligned(judul, pdfgen.AlignCenter)
	d.MoveDown(0.2)
	d.Font(pdfgen.Helvetica, 10.5)
	w.aligned("Nomor: "+c.Str("contract_number"), pdfgen.AlignCenter)
	d.MoveDown(1)

	w.para("Pada hari ini, tanggal " + tanggalTtd + ", bertempat di " + city + ", " +
		"telah dibuat dan ditandatangani perjanjian kerja oleh dan antara:")
	d.MoveDown(0.2)
	w.party("Nama", val(co["company_signer_name"]))
	w.party("Jabatan", val(co["company_signer_title"]))
	w.party("Bertindak atas nama", val(co["company_legal_name"]))
	w.party("Alamat", val(co["company_address"]))
	w.para(`Selanjutnya disebut sebagai "PIHAK PERTAMA" (Pengusaha).`)
	d.MoveDown(0.3)

	var addr []string
	for _, k := range []string{"address", "city"} {
		if v := emp.Str(k); v != "" {
			addr = append(addr, v)
		}
	}
	address := strings.Join(addr, ", ")
	w.party("Nama", emp.Str("full_name"))
	w.party("NIK (KTP)", val(emp.StrPtr("ktp")))
	w.party("Tanggal lahir", dateID(emp.StrPtr("birth_date")))
	w.party("Alamat", val(&address))
	w.party("No. telepon", val(emp.StrPtr("phone")))
	w.para(`Selanjutnya disebut sebagai "PIHAK KEDUA" (Pekerja).`)
	d.MoveDown(0.2)
	w.para("Kedua belah pihak sepakat mengikatkan diri dalam perjanjian kerja dengan ketentuan sebagai berikut:")

	position := val(c.StrPtr("position_title"))
	dept := "."
	if v := c.Str("department_name"); v != "" {
		dept = " pada departemen " + v + "."
	}
	w.pasal(1, "Jenis Pekerjaan, Jabatan, dan Penempatan")
	w.numbered(
		"PIHAK PERTAMA mempekerjakan PIHAK KEDUA sebagai "+position+dept,
		"Tempat kerja PIHAK KEDUA adalah "+val(c.StrPtr("work_location"))+", dengan kemungkinan "+
			"penugasan di lokasi lain sesuai kebutuhan operasional yang wajar.",
	)

	start := dateID(c.StrPtr("start_date"))
	w.pasal(2, "Jangka Waktu Perjanjian")
	if isPkwt {
		w.numbered(
			"Perjanjian ini berlaku untuk waktu tertentu, terhitung sejak tanggal "+start+" "+
				"sampai dengan tanggal "+dateID(c.StrPtr("end_date"))+".",
			"Perjanjian ini TIDAK mensyaratkan masa percobaan, sesuai ketentuan PKWT dalam "+
				"PP Nomor 35 Tahun 2021.",
			"Perpanjangan perjanjian hanya dapat dilakukan sepanjang jangka waktu keseluruhan "+
				"PKWT (termasuk perpanjangan) tidak melebihi 5 (lima) tahun.",
		)
	} else {
		items := []string{"Perjanjian ini berlaku untuk waktu tidak tertentu, terhitung sejak tanggal " + start + "."}
		if p := c.StrPtr("probation_end_date"); p != nil {
			items = append(items, "PIHAK KEDUA menjalani masa percobaan sampai dengan tanggal "+dateID(p)+" "+
				"(maksimal 3 bulan sesuai Pasal 60 UU Nomor 13 Tahun 2003). Selama masa percobaan, "+
				"upah dibayarkan penuh dan masing-masing pihak dapat mengakhiri hubungan kerja.")
		}
		w.numbered(items...)
	}

	w.pasal(3, "Upah dan Cara Pembayaran")
	w.numbered(
		"PIHAK PERTAMA membayar upah pokok kepada PIHAK KEDUA sebesar "+idr(c.StrPtr("base_salary"))+" per bulan.",
		"Upah dibayarkan selambat-lambatnya pada akhir bulan berjalan melalui transfer ke "+
			"rekening bank milik PIHAK KEDUA.",
		"Pajak penghasilan (PPh 21) atas upah ditanggung dan/atau dipotong sesuai ketentuan "+
			"peraturan perpajakan yang berlaku.",
	)

	w.pasal(4, "Waktu Kerja dan Istirahat")
	w.numbered(
		"Waktu kerja adalah 7 (tujuh) jam sehari dan 40 (empat puluh) jam seminggu untuk 6 "+
			"hari kerja, atau 8 (delapan) jam sehari dan 40 (empat puluh) jam seminggu untuk 5 "+
			"hari kerja, sesuai pengaturan jadwal oleh PIHAK PERTAMA.",
		"Kerja lembur hanya dilakukan atas persetujuan kedua belah pihak dan diberikan upah "+
			"lembur sesuai ketentuan peraturan perundang-undangan.",
		"PIHAK KEDUA berhak atas istirahat mingguan, istirahat antar jam kerja, cuti tahunan, "+
			"dan hak istirahat lain sesuai peraturan perundang-undangan.",
	)

	w.pasal(5, "Jaminan Sosial dan Hak-Hak Lainnya")
	w.numbered(
		"PIHAK PERTAMA mengikutsertakan PIHAK KEDUA dalam program BPJS Ketenagakerjaan dan "+
			"BPJS Kesehatan sesuai ketentuan yang berlaku.",
		"PIHAK KEDUA wajib menaati peraturan perusahaan, menjaga kerahasiaan data dan "+
			"informasi milik perusahaan, serta melaksanakan pekerjaan dengan penuh tanggung jawab.",
	)

	n := 6
	if isPkwt {
		w.pasal(n, "Uang Kompensasi")
		w.numbered(
			"Pada saat berakhirnya perjanjian ini, PIHAK PERTAMA membayar uang kompensasi "+
				"kepada PIHAK KEDUA sesuai Pasal 15-16 PP Nomor 35 Tahun 2021, yaitu sebesar "+
				"(masa kerja dalam bulan / 12) x 1 (satu) bulan upah, secara proporsional.",
			"Uang kompensasi juga dibayarkan secara proporsional apabila perjanjian diakhiri "+
				"lebih awal oleh salah satu pihak.",
		)
		n++
	}

	w.pasal(n, "Berakhirnya Hubungan Kerja")
	if isPkwt {
		w.numbered(
			"Hubungan kerja berakhir demi hukum pada saat berakhirnya jangka waktu perjanjian.",
			"Pihak yang mengakhiri hubungan kerja sebelum berakhirnya jangka waktu wajib "+
				"memberitahukan secara tertulis paling lambat 14 (empat belas) hari sebelumnya.",
		)
	} else {
		w.numbered("Pengakhiran hubungan kerja dilaksanakan sesuai ketentuan pemutusan hubungan " +
			"kerja dalam UU Nomor 13 Tahun 2003 jo. UU Cipta Kerja beserta peraturan pelaksananya, " +
			"termasuk hak atas pesangon, penghargaan masa kerja, dan penggantian hak.")
	}
	n++

	w.pasal(n, "Penyelesaian Perselisihan")
	w.numbered(
		"Perselisihan yang timbul dari perjanjian ini diselesaikan terlebih dahulu secara "+
			"musyawarah (bipartit).",
		"Apabila musyawarah tidak mencapai kesepakatan, penyelesaian dilakukan sesuai UU "+
			"Nomor 2 Tahun 2004 tentang Penyelesaian Perselisihan Hubungan Industrial.",
	)
	n++

	w.pasal(n, "Penutup")
	w.para("Perjanjian ini dibuat dalam rangkap 2 (dua) bermeterai cukup, masing-masing " +
		"mempunyai kekuatan hukum yang sama, dan ditandatangani secara sadar tanpa paksaan " +
		"dari pihak manapun. Hal-hal yang belum diatur dalam perjanjian ini mengacu pada " +
		"peraturan perusahaan dan peraturan perundang-undangan yang berlaku.")

	// Signature block.
	d.EnsureSpace(150)
	d.MoveDown(1.2)
	d.Font(pdfgen.Helvetica, 10)
	w.aligned(city+", "+tanggalTtd, pdfgen.AlignRight)
	d.MoveDown(0.8)
	colW := d.ContentWidth() / 2
	left, right := d.Left(), d.Left()+colW
	top := d.Y
	d.Font(pdfgen.HelveticaBold, 10)
	d.Text("PIHAK PERTAMA,", left, top, pdfgen.TextOpts{Width: colW, Align: pdfgen.AlignCenter})
	d.Text("PIHAK KEDUA,", right, top, pdfgen.TextOpts{Width: colW, Align: pdfgen.AlignCenter})
	sign := top + 84
	d.Font(pdfgen.Helvetica, 10)
	for _, s := range []struct {
		x    float64
		name string
	}{{left, val(co["company_signer_name"])}, {right, emp.Str("full_name")}} {
		d.Text(s.name, s.x, sign, pdfgen.TextOpts{Width: colW, Align: pdfgen.AlignCenter})
		nameW := min(d.StringWidth(s.name), colW)
		under := sign + d.LineHeight() - 1
		d.Line(s.x+(colW-nameW)/2, under, s.x+(colW+nameW)/2, under, "#111827", 0.7)
	}
	d.Font(pdfgen.Helvetica, 9).Color("#6b7280")
	d.Text(val(co["company_signer_title"]), left, sign+14, pdfgen.TextOpts{Width: colW, Align: pdfgen.AlignCenter})
	d.Text(val(c.StrPtr("position_title")), right, sign+14, pdfgen.TextOpts{Width: colW, Align: pdfgen.AlignCenter})
	return d.Bytes()
}
