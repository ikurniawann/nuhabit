package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/smtp"
	"net/textproto"
	"os"
	"strconv"
	"strings"
	"time"
)

// SMTP is authenticated client submission over STARTTLS, the setup Microsoft
// documents for smtp.office365.com:587 (learn.microsoft.com/exchange/
// mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-
// to-send-email-using-microsoft-365-or-office-365). The password never goes
// over a plain connection: a server without STARTTLS is refused.
type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	// TLS overrides the client TLS config (tests use a self-signed server).
	TLS     *tls.Config
	Timeout time.Duration
}

func (s *SMTP) Name() string { return ProviderSMTP }

func (s *SMTP) Send(ctx context.Context, m Message) (string, error) {
	if s.Host == "" || s.Username == "" || s.Password == "" {
		return "", errors.New("SMTP: host, user atau password kosong")
	}
	timeout := s.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	port := s.Port
	if port <= 0 {
		port = 587
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(s.Host, strconv.Itoa(port)))
	if err != nil {
		return "", Transient(fmt.Errorf("SMTP: %w", err))
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	c, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		_ = conn.Close()
		return "", smtpError(err)
	}
	defer c.Close()
	if err := c.Hello(localName()); err != nil {
		return "", smtpError(err)
	}
	if ok, _ := c.Extension("STARTTLS"); !ok {
		return "", errors.New("SMTP: server tidak menawarkan STARTTLS; kirim tanpa TLS ditolak")
	}
	tlsConfig := s.TLS
	if tlsConfig == nil {
		tlsConfig = &tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}
	}
	if err := c.StartTLS(tlsConfig); err != nil {
		return "", smtpError(err)
	}
	if err := c.Auth(s.auth(c)); err != nil {
		return "", smtpError(err)
	}
	if err := c.Mail(m.From); err != nil {
		return "", smtpError(err)
	}
	if err := c.Rcpt(m.To); err != nil {
		return "", smtpError(err)
	}
	w, err := c.Data()
	if err != nil {
		return "", smtpError(err)
	}
	messageID := fmt.Sprintf("<%s@%s>", newRequestID(), domainOf(m.From))
	if _, err := w.Write(buildMIME(m, messageID)); err != nil {
		return "", smtpError(err)
	}
	if err := w.Close(); err != nil {
		return "", smtpError(err)
	}
	_ = c.Quit()
	return messageID, nil
}

// auth picks LOGIN when the server lists it (what Exchange Online offers),
// else PLAIN.
func (s *SMTP) auth(c *smtp.Client) smtp.Auth {
	if _, mechs := c.Extension("AUTH"); strings.Contains(" "+strings.ToUpper(mechs)+" ", " LOGIN ") {
		return loginAuth{user: s.Username, pass: s.Password}
	}
	return smtp.PlainAuth("", s.Username, s.Password, s.Host)
}

// loginAuth is the AUTH LOGIN mechanism: username then password, each
// answered to a base64 prompt. It runs only on a TLS connection.
type loginAuth struct{ user, pass string }

func (a loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS {
		return "", nil, errors.New("SMTP: AUTH LOGIN butuh koneksi TLS")
	}
	return "LOGIN", nil, nil
}

func (a loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(fromServer))) {
	case "username:":
		return []byte(a.user), nil
	case "password:":
		return []byte(a.pass), nil
	}
	return nil, fmt.Errorf("SMTP: tantangan LOGIN tidak dikenal %q", fromServer)
}

// smtpError classifies a reply: 4xx is transient, 5xx permanent, anything
// else (connection trouble) transient.
func smtpError(err error) error {
	var reply *textproto.Error
	if errors.As(err, &reply) {
		wrapped := fmt.Errorf("SMTP %d: %s", reply.Code, reply.Msg)
		if reply.Code >= 500 {
			return wrapped
		}
		return Transient(wrapped)
	}
	if errors.Is(err, io.EOF) || IsTransient(err) {
		return Transient(fmt.Errorf("SMTP: %w", err))
	}
	return fmt.Errorf("SMTP: %w", err)
}

// buildMIME renders the message: a text/html body, or multipart/mixed with
// base64 attachments. Headers with non-ASCII text are Q-encoded.
func buildMIME(m Message, messageID string) []byte {
	var b bytes.Buffer
	header := func(name, value string) { fmt.Fprintf(&b, "%s: %s\r\n", name, value) }
	fromName := m.FromName
	if fromName != "" {
		fromName = mime.QEncoding.Encode("utf-8", fromName)
	}
	header("From", formatAddress(m.From, fromName))
	header("To", m.To)
	header("Subject", mime.QEncoding.Encode("utf-8", m.Subject))
	header("Date", time.Now().Format(time.RFC1123Z))
	header("Message-ID", messageID)
	header("MIME-Version", "1.0")
	if len(m.Attachments) == 0 {
		header("Content-Type", `text/html; charset="utf-8"`)
		header("Content-Transfer-Encoding", "base64")
		b.WriteString("\r\n")
		writeBase64(&b, []byte(m.HTML))
		return b.Bytes()
	}
	boundary := "nuhabit-" + strings.ReplaceAll(newRequestID(), "-", "")
	header("Content-Type", `multipart/mixed; boundary="`+boundary+`"`)
	b.WriteString("\r\n--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=\"utf-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n")
	writeBase64(&b, []byte(m.HTML))
	for _, a := range m.Attachments {
		ct := a.ContentType
		if ct == "" {
			ct = "application/octet-stream"
		}
		name := mime.QEncoding.Encode("utf-8", a.Filename)
		b.WriteString("--" + boundary + "\r\n")
		fmt.Fprintf(&b, "Content-Type: %s; name=\"%s\"\r\n", ct, name)
		fmt.Fprintf(&b, "Content-Disposition: attachment; filename=\"%s\"\r\n", name)
		b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
		writeBase64(&b, a.Content)
	}
	b.WriteString("--" + boundary + "--\r\n")
	return b.Bytes()
}

// writeBase64 writes data base64-encoded in 76-column lines.
func writeBase64(b *bytes.Buffer, data []byte) {
	encoded := base64.StdEncoding.EncodeToString(data)
	for len(encoded) > 76 {
		b.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	b.WriteString(encoded + "\r\n")
}

func domainOf(addr string) string {
	if i := strings.LastIndex(addr, "@"); i >= 0 && i < len(addr)-1 {
		return addr[i+1:]
	}
	return "localhost"
}

// localName is the EHLO name: the host name, else localhost.
func localName() string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return "localhost"
}
