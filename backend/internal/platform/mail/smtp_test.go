package mail

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// smtpStub is a one-connection SMTP server with STARTTLS and AUTH LOGIN.
type smtpStub struct {
	ln   net.Listener
	cert tls.Certificate
	// rcptReply overrides the RCPT TO answer ("" is 250).
	rcptReply string
	// noTLS hides STARTTLS from EHLO.
	noTLS bool

	mu     sync.Mutex
	user   string
	pass   string
	from   string
	rcpt   string
	data   string
	tlsOn  bool
	closed bool
}

func selfSigned(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)}}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func newSMTPStub(t *testing.T) *smtpStub {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &smtpStub{ln: ln, cert: selfSigned(t)}
	t.Cleanup(func() { _ = ln.Close() })
	go s.serve()
	return s
}

func (s *smtpStub) addr() (string, int) {
	a := s.ln.Addr().(*net.TCPAddr)
	return a.IP.String(), a.Port
}

func (s *smtpStub) serve() {
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.handle(conn)
	}
}

func (s *smtpStub) handle(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	r := bufio.NewReader(conn)
	write := func(line string) { _, _ = conn.Write([]byte(line + "\r\n")) }
	readLine := func() string {
		line, err := r.ReadString('\n')
		if err != nil {
			return ""
		}
		return strings.TrimRight(line, "\r\n")
	}
	write("220 stub ESMTP")
	secured := false
	for {
		line := readLine()
		if line == "" {
			return
		}
		cmd := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(cmd, "EHLO"):
			write("250-stub")
			if !s.noTLS && !secured {
				write("250-STARTTLS")
			}
			write("250 AUTH LOGIN PLAIN")
		case cmd == "STARTTLS":
			write("220 Ready to start TLS")
			tlsConn := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{s.cert}})
			if err := tlsConn.Handshake(); err != nil {
				return
			}
			conn = tlsConn
			r = bufio.NewReader(conn)
			secured = true
			s.mu.Lock()
			s.tlsOn = true
			s.mu.Unlock()
		case strings.HasPrefix(cmd, "AUTH LOGIN"):
			write("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
			user, _ := base64.StdEncoding.DecodeString(readLine())
			write("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
			pass, _ := base64.StdEncoding.DecodeString(readLine())
			s.mu.Lock()
			s.user, s.pass = string(user), string(pass)
			s.mu.Unlock()
			write("235 2.7.0 Authentication successful")
		case strings.HasPrefix(cmd, "MAIL FROM:"):
			s.mu.Lock()
			s.from = line[len("MAIL FROM:"):]
			s.mu.Unlock()
			write("250 OK")
		case strings.HasPrefix(cmd, "RCPT TO:"):
			s.mu.Lock()
			s.rcpt = line[len("RCPT TO:"):]
			s.mu.Unlock()
			if s.rcptReply != "" {
				write(s.rcptReply)
			} else {
				write("250 OK")
			}
		case cmd == "DATA":
			write("354 Start mail input")
			var b strings.Builder
			for {
				l := readLine()
				if l == "." {
					break
				}
				b.WriteString(l + "\n")
			}
			s.mu.Lock()
			s.data = b.String()
			s.mu.Unlock()
			write("250 2.0.0 OK <queued>")
		case cmd == "QUIT":
			write("221 Bye")
			return
		default:
			write("250 OK")
		}
	}
}

func testSMTP(stub *smtpStub) *SMTP {
	host, port := stub.addr()
	return &SMTP{Host: host, Port: port, Username: "ops@outlook.com", Password: "app-password",
		TLS: &tls.Config{InsecureSkipVerify: true}, Timeout: 10 * time.Second}
}

func TestSMTPSendsOverStartTLSWithLogin(t *testing.T) {
	stub := newSMTPStub(t)
	id, err := testSMTP(stub).Send(context.Background(), Message{To: "member@example.com", From: "ops@outlook.com", FromName: "NüHabit Gym",
		Subject: "Kode akses: 123456", HTML: "<p>Halo</p>", Attachments: []Attachment{{Filename: "slip.pdf", ContentType: "application/pdf", Content: []byte("%PDF")}}})
	if err != nil {
		t.Fatal(err)
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if !stub.tlsOn || stub.user != "ops@outlook.com" || stub.pass != "app-password" {
		t.Errorf("tls=%v user=%q pass set=%v", stub.tlsOn, stub.user, stub.pass != "")
	}
	if stub.from != "<ops@outlook.com>" || stub.rcpt != "<member@example.com>" {
		t.Errorf("envelope from=%q rcpt=%q", stub.from, stub.rcpt)
	}
	if !strings.HasPrefix(id, "<") || !strings.HasSuffix(id, "@outlook.com>") || !strings.Contains(stub.data, "Message-ID: "+id) {
		t.Errorf("message id %q not in headers", id)
	}
	for _, want := range []string{
		"From: =?utf-8?q?N=C3=BCHabit_Gym?= <ops@outlook.com>",
		"To: member@example.com",
		"Subject: Kode akses: 123456",
		"Content-Type: multipart/mixed; boundary=",
		"Content-Type: application/pdf; name=\"slip.pdf\"",
		"Content-Disposition: attachment; filename=\"slip.pdf\"",
		base64.StdEncoding.EncodeToString([]byte("<p>Halo</p>")),
		base64.StdEncoding.EncodeToString([]byte("%PDF")),
	} {
		if !strings.Contains(stub.data, want) {
			t.Errorf("DATA lacks %q:\n%s", want, stub.data)
		}
	}
}

func TestSMTPClassifiesReplies(t *testing.T) {
	stub := newSMTPStub(t)
	stub.rcptReply = "451 4.7.0 Temporary server error. Please try again later"
	_, err := testSMTP(stub).Send(context.Background(), Message{To: "a@example.com", From: "ops@outlook.com", Subject: "s", HTML: "h"})
	if !IsTransient(err) || !strings.Contains(err.Error(), "SMTP 451") {
		t.Fatalf("4xx must be transient: %v", err)
	}
	stub.rcptReply = "550 5.7.60 SMTP; Client does not have permissions to send as this sender"
	_, err = testSMTP(stub).Send(context.Background(), Message{To: "a@example.com", From: "ops@outlook.com", Subject: "s", HTML: "h"})
	if err == nil || IsTransient(err) || !strings.Contains(err.Error(), "5.7.60") {
		t.Fatalf("5xx must be permanent with the server text: %v", err)
	}
}

func TestSMTPRefusesServerWithoutStartTLS(t *testing.T) {
	stub := newSMTPStub(t)
	stub.noTLS = true
	_, err := testSMTP(stub).Send(context.Background(), Message{To: "a@example.com", From: "ops@outlook.com", Subject: "s", HTML: "h"})
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("plain connection must be refused: %v", err)
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if stub.user != "" {
		t.Error("credentials must not be sent without TLS")
	}
}
