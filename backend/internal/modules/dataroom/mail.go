package dataroom

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Share emails (lib/dataroom/mail.ts), sent through the Mailer port.

var htmlEscaper = strings.NewReplacer("<", "&lt;", ">", "&gt;", "&", "&amp;", `"`, "&quot;")

func esc(s string) string { return htmlEscaper.Replace(s) }

func (s *Service) shell(title, body string) string {
	return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">
  <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 8px">` + esc(s.ports.Brand) + ` · Dataroom</p>
  <h1 style="font-size:20px;margin:0 0 16px">` + esc(title) + `</h1>
  ` + body + `
  <p style="font-size:12px;color:#9ca3af;margin-top:24px">Email ini dikirim otomatis. Bila Anda tidak merasa meminta akses, abaikan saja.</p>
</div>`
}

// renderCodeEmail is renderCodeEmail.
func (s *Service) renderCodeEmail(code, shareName string, minutes int) string {
	return s.shell("Kode verifikasi akses", `
  <p>Gunakan kode berikut untuk membuka <strong>`+esc(shareName)+`</strong>:</p>
  <p style="font-size:32px;letter-spacing:.35em;font-weight:700;margin:16px 0;font-variant-numeric:tabular-nums">`+esc(code)+`</p>
  <p style="color:#6b7280">Kode berlaku `+fmt.Sprint(minutes)+` menit dan hanya bisa dipakai sekali.</p>`)
}

var idMonths = [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}

// jakartaUntil is toLocaleString("id-ID", { day: "2-digit", month: "long",
// year: "numeric", hour: "2-digit", minute: "2-digit", timeZone:
// "Asia/Jakarta" }), e.g. "11 Oktober 2026 pukul 07.05".
func jakartaUntil(t time.Time) string {
	j := t.In(jakarta)
	return fmt.Sprintf("%02d %s %d pukul %02d.%02d", j.Day(), idMonths[j.Month()-1], j.Year(), j.Hour(), j.Minute())
}

var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

// renderLinkEmail is renderLinkEmail.
func (s *Service) renderLinkEmail(shareName, kind, link, senderName string, expiresAt time.Time, hasPin bool) string {
	noun := "file"
	if kind == "folder" {
		noun = "folder"
	}
	pin := ""
	if hasPin {
		pin = " dan memasukkan PIN yang diberikan pengirim"
	}
	return s.shell(senderName+" membagikan "+noun+" kepada Anda", `
  <p><strong>`+esc(shareName)+`</strong></p>
  <p><a href="`+esc(link)+`" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Buka `+noun+`</a></p>
  <p style="color:#6b7280;font-size:14px">Link aktif sampai `+esc(jakartaUntil(expiresAt))+` WIB. Saat membuka, Anda akan diminta memverifikasi email ini`+pin+`.</p>
  <p style="font-size:12px;color:#9ca3af;word-break:break-all">`+esc(link)+`</p>`)
}

// sendShareCode is sendShareCode; outside production the code is also
// logged for local testing.
func (s *Service) sendShareCode(ctx context.Context, email, code, shareName string) bool {
	if !s.production {
		s.log.Info(fmt.Sprintf("[dataroom] kode verifikasi %s: %s", email, code))
	}
	return s.ports.Mailer.Send(ctx, email, s.ports.MailFrom, "Kode akses Dataroom: "+code, s.renderCodeEmail(code, shareName, 10))
}

// sendShareLink is sendShareLink: one email per recipient.
func (s *Service) sendShareLink(ctx context.Context, emails []string, node *Node, token, senderName string, expiresAt time.Time, hasPin bool) *MailResult {
	link := s.shareURL(token)
	out := &MailResult{Failed: []string{}}
	for _, email := range emails {
		subject := fmt.Sprintf(`%s membagikan "%s" (%s Dataroom)`, senderName, node.Name, s.ports.Brand)
		if s.ports.Mailer.Send(ctx, email, s.ports.MailFrom, subject, s.renderLinkEmail(node.Name, node.Kind, link, senderName, expiresAt, hasPin)) {
			out.Sent++
		} else {
			out.Failed = append(out.Failed, email)
		}
	}
	return out
}
