package engagement

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/platform/database"
)

// WebPush implements Pusher: a port of lib/member-portal/push.ts (VAPID web
// push, RFC 8291 aes128gcm payload encryption, RFC 8292 VAPID auth) with
// the keys from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
// Without keys every send is a no-op. Delivery is best effort.
// Stopgap adapter: moves to member-portal (it owns member push subscriptions).
type WebPush struct {
	DB     database.Querier
	Getenv func(string) string
	Client *http.Client
	Log    *slog.Logger
	Now    func() time.Time
}

var _ Pusher = (*WebPush)(nil)

// NewWebPush builds the adapter on the process environment.
func NewWebPush(db database.Querier, log *slog.Logger, now func() time.Time) *WebPush {
	if now == nil {
		now = time.Now
	}
	return &WebPush{DB: db, Getenv: os.Getenv, Client: &http.Client{Timeout: 30 * time.Second}, Log: log, Now: now}
}

type vapidConfig struct {
	publicKey  string
	privateKey string
	subject    string
}

func (p *WebPush) config() *vapidConfig {
	pub := strings.TrimSpace(p.Getenv("VAPID_PUBLIC_KEY"))
	priv := strings.TrimSpace(p.Getenv("VAPID_PRIVATE_KEY"))
	if pub == "" || priv == "" {
		return nil
	}
	subject := strings.TrimSpace(p.Getenv("VAPID_SUBJECT"))
	if subject == "" {
		subject = "mailto:admin@localhost"
	}
	return &vapidConfig{publicKey: pub, privateKey: priv, subject: subject}
}

// SendMember pushes to every device of the member (sendMemberPush).
func (p *WebPush) SendMember(customerID string, msg domain.PushMessage) {
	p.sendAsync(`SELECT id, endpoint, p256dh, auth FROM crm.member_push_subscriptions WHERE customer_id = $1`, customerID, msg)
}

// SendAnnouncement pushes to the subscribed recipients of one announcement
// (sendAnnouncementPush).
func (p *WebPush) SendAnnouncement(announcementID string, msg domain.PushMessage) {
	p.sendAsync(`SELECT s.id, s.endpoint, s.p256dh, s.auth
         FROM crm.member_push_subscriptions s
        WHERE s.customer_id IN (SELECT customer_id FROM crm.member_notifications WHERE announcement_id = $1)`, announcementID, msg)
}

func (p *WebPush) sendAsync(query, arg string, msg domain.PushMessage) {
	cfg := p.config()
	if cfg == nil {
		return
	}
	go p.deliver(context.Background(), cfg, query, arg, domain.PushPayload(msg))
}

func (p *WebPush) deliver(ctx context.Context, cfg *vapidConfig, query, arg string, payload []byte) {
	rows, err := p.DB.Query(ctx, query, arg)
	if err != nil {
		p.Log.Warn("[member-push] gagal", "error", err.Error())
		return
	}
	type sub struct{ id, endpoint, p256dh, auth string }
	var subs []sub
	for rows.Next() {
		var s sub
		if rows.Scan(&s.id, &s.endpoint, &s.p256dh, &s.auth) == nil {
			subs = append(subs, s)
		}
	}
	rows.Close()
	var wg sync.WaitGroup
	for _, s := range subs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, err := p.send(ctx, cfg, s.endpoint, s.p256dh, s.auth, payload)
			switch {
			case err == nil:
				_, _ = p.DB.Exec(ctx, `UPDATE crm.member_push_subscriptions SET last_sent_at = now() WHERE id = $1`, s.id)
			case status == http.StatusNotFound || status == http.StatusGone:
				// The device revoked the subscription; drop it.
				_, _ = p.DB.Exec(ctx, `DELETE FROM crm.member_push_subscriptions WHERE id = $1`, s.id)
			default:
				p.Log.Warn("[member-push] kirim gagal", "status", status, "error", err.Error())
			}
		}()
	}
	wg.Wait()
}

var b64 = base64.RawURLEncoding

func decodeB64(s string) ([]byte, error) {
	return b64.DecodeString(strings.TrimRight(strings.NewReplacer("+", "-", "/", "_").Replace(s), "="))
}

// send encrypts payload for one subscription and posts it with VAPID auth.
func (p *WebPush) send(ctx context.Context, cfg *vapidConfig, endpoint, p256dh, authSecret string, payload []byte) (int, error) {
	body, err := encryptAES128GCM(payload, p256dh, authSecret)
	if err != nil {
		return 0, err
	}
	jwt, err := vapidJWT(cfg, endpoint, p.Now())
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("TTL", strconv.Itoa(24*60*60))
	req.Header.Set("Urgency", "normal")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Authorization", "vapid t="+jwt+", k="+cfg.publicKey)
	resp, err := p.Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return resp.StatusCode, errors.New("push service answered " + resp.Status)
	}
	return resp.StatusCode, nil
}

// vapidJWT signs {aud, exp (+12h), sub} with ES256.
func vapidJWT(cfg *vapidConfig, endpoint string, now time.Time) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	privRaw, err := decodeB64(cfg.privateKey)
	if err != nil {
		return "", err
	}
	key, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), privRaw)
	if err != nil {
		return "", err
	}
	header := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{
		"aud": u.Scheme + "://" + u.Host,
		"exp": now.Add(12 * time.Hour).Unix(),
		"sub": cfg.subject,
	})
	signing := header + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return signing + "." + b64.EncodeToString(sig), nil
}

// encryptAES128GCM implements RFC 8291 with a single record.
func encryptAES128GCM(plaintext []byte, p256dh, authSecret string) ([]byte, error) {
	uaPubRaw, err := decodeB64(p256dh)
	if err != nil {
		return nil, err
	}
	auth, err := decodeB64(authSecret)
	if err != nil {
		return nil, err
	}
	curve := ecdh.P256()
	uaPub, err := curve.NewPublicKey(uaPubRaw)
	if err != nil {
		return nil, err
	}
	asPriv, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	asPub := asPriv.PublicKey().Bytes()
	shared, err := asPriv.ECDH(uaPub)
	if err != nil {
		return nil, err
	}
	prkKey, err := hkdf.Extract(sha256.New, shared, auth)
	if err != nil {
		return nil, err
	}
	keyInfo := "WebPush: info\x00" + string(uaPubRaw) + string(asPub)
	ikm, err := hkdf.Expand(sha256.New, prkKey, keyInfo, 32)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	record := append(append([]byte{}, plaintext...), 0x02)
	ciphertext := gcm.Seal(nil, nonce, record, nil)

	header := make([]byte, 0, 16+4+1+len(asPub))
	header = append(header, salt...)
	header = binary.BigEndian.AppendUint32(header, 4096)
	header = append(header, byte(len(asPub)))
	header = append(header, asPub...)
	return append(header, ciphertext...), nil
}
