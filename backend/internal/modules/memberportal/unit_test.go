package memberportal

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"math/big"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// decryptAES128GCM is the user-agent side of RFC 8291, to check the sender.
func decryptAES128GCM(t *testing.T, body []byte, ua *ecdh.PrivateKey, auth []byte) []byte {
	t.Helper()
	salt := body[:16]
	if rs := binary.BigEndian.Uint32(body[16:20]); rs != 4096 {
		t.Fatalf("record size %d", rs)
	}
	idlen := int(body[20])
	asPubRaw := body[21 : 21+idlen]
	ciphertext := body[21+idlen:]
	asPub, err := ecdh.P256().NewPublicKey(asPubRaw)
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := ua.ECDH(asPub)
	prkKey, _ := hkdf.Extract(sha256.New, shared, auth)
	ikm, _ := hkdf.Expand(sha256.New, prkKey, "WebPush: info\x00"+string(ua.PublicKey().Bytes())+string(asPubRaw), 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plain[len(plain)-1] != 0x02 {
		t.Fatal("missing last-record delimiter")
	}
	return plain[:len(plain)-1]
}

func TestWebPushEncryptionRoundTrip(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	payload := pushPayload(PushMessage{Title: "Terdaftar: Yoga", Body: "Sampai jumpa", Type: "booking_confirmed"})
	body, err := encryptAES128GCM(payload, b64.EncodeToString(ua.PublicKey().Bytes()), b64.EncodeToString(auth))
	if err != nil {
		t.Fatal(err)
	}
	got := decryptAES128GCM(t, body, ua, auth)
	var decoded map[string]string
	if err := json.Unmarshal(got, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["url"] != "/member?go=events" || decoded["tag"] != "booking_confirmed" || decoded["title"] != "Terdaftar: Yoga" {
		t.Fatalf("payload %v", decoded)
	}
}

func TestPushPayloadClipsAndDefaults(t *testing.T) {
	var decoded map[string]string
	_ = json.Unmarshal(pushPayload(PushMessage{Title: "  ", Body: strings.Repeat("x", 200)}), &decoded)
	if decoded["title"] != "NüHabit" || decoded["url"] != "/member" || decoded["tag"] != "member" {
		t.Fatalf("defaults %v", decoded)
	}
	if n := len([]rune(decoded["body"])); n != 180 || !strings.HasSuffix(decoded["body"], "…") {
		t.Fatalf("body clipped to %d", n)
	}
}

func TestVAPIDJWTVerifies(t *testing.T) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	priv := make([]byte, 32)
	key.D.FillBytes(priv)
	pub, _ := key.PublicKey.Bytes()
	cfg := &vapidConfig{publicKey: b64.EncodeToString(pub), privateKey: b64.EncodeToString(priv), subject: "mailto:a@b.c"}
	jwt, err := vapidJWT(cfg, "https://fcm.googleapis.com/fcm/send/abc", time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(jwt, ".")
	claims, _ := b64.DecodeString(parts[1])
	var c map[string]any
	_ = json.Unmarshal(claims, &c)
	if c["aud"] != "https://fcm.googleapis.com" || c["sub"] != "mailto:a@b.c" || c["exp"].(float64) != 1_700_000_000+12*3600 {
		t.Fatalf("claims %v", c)
	}
	sig, _ := b64.DecodeString(parts[2])
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(&key.PublicKey, digest[:], r, s) {
		t.Fatal("signature does not verify")
	}
}

func TestClientIPAndSecureCookie(t *testing.T) {
	r := httptest.NewRequest("POST", "http://10.20.89.5:3000/api/member-portal/verify", nil)
	if clientIP(r.Header) != "unknown" {
		t.Fatal("no headers")
	}
	r.Header.Set("x-real-ip", "3.3.3.3")
	r.Header.Set("x-forwarded-for", "2.2.2.2, 9.9.9.9")
	if clientIP(r.Header) != "2.2.2.2" {
		t.Fatal("forwarded-for first hop")
	}
	r.Header.Set("cf-connecting-ip", "1.1.1.1")
	if clientIP(r.Header) != "1.1.1.1" {
		t.Fatal("cloudflare wins")
	}
	if isSecureRequest(r) {
		t.Fatal("IP host is plain HTTP")
	}
	r.Header.Set("x-forwarded-proto", "https")
	if !isSecureRequest(r) {
		t.Fatal("forwarded https")
	}
	d := httptest.NewRequest("GET", "http://member.example.com/", nil)
	d.Header.Set("x-forwarded-proto", "http")
	if !isSecureRequest(d) {
		t.Fatal("domain hosts are always behind TLS")
	}
	for _, host := range []string{"localhost:3000", "[::1]:3000"} {
		l := httptest.NewRequest("GET", "http://"+host+"/", nil)
		if isSecureRequest(l) {
			t.Fatalf("%s must not be secure", host)
		}
	}
}

func TestParseTopupRequest(t *testing.T) {
	cases := []struct {
		raw  any
		want string
	}{
		{map[string]any{}, "Pilih paket atau isi nominal"},
		{map[string]any{"package_id": "x"}, "Invalid UUID"},
		{map[string]any{"amount": 1.5}, "Invalid input: expected int, received number"},
		{map[string]any{"amount": -1.0}, "Too small: expected number to be >0"},
		{map[string]any{"amount": 0.0}, "Too small: expected number to be >0"},
		{map[string]any{"amount": "10"}, "Invalid input: expected number, received string"},
		{map[string]any{"package_id": 5.0}, "Invalid input: expected string, received number"},
		{nil, "Invalid input: expected object, received null"},
		{[]any{}, "Invalid input: expected object, received array"},
		{map[string]any{"amount": 10000.0, "package_id": "00000000-0000-4000-8000-000000000001"}, "Pilih paket atau isi nominal"},
		{map[string]any{"amount": 10000.0}, ""},
		{map[string]any{"package_id": "00000000-0000-4000-8000-000000000001", "amount": nil}, ""},
	}
	for _, c := range cases {
		if _, got := parseTopupRequest(c.raw, true); got != c.want {
			t.Errorf("%v: got %q want %q", c.raw, got, c.want)
		}
	}
}

func TestParseProfileUpdate(t *testing.T) {
	in, ok := parseProfileUpdate(map[string]any{"name": "  Sari ", "email": "", "gender": "female", "city": " Bandung ", "wa_consent": true})
	if !ok || *in.Name != "Sari" || *in.Email != "" || *in.Gender != "female" || *in.City != "Bandung" || !*in.WAConsent {
		t.Fatalf("valid body: %+v %v", in, ok)
	}
	for _, bad := range []map[string]any{
		{"name": ""}, {"email": "bukan-email"}, {"birth_date": "17-05-1990"}, {"gender": "x"},
		{"wa_consent": "true"}, {"name": 5.0}, {"city": strings.Repeat("x", 121)},
	} {
		if _, ok := parseProfileUpdate(bad); ok {
			t.Errorf("%v accepted", bad)
		}
	}
	if !isZodEmail("a.b+c@mail.co.id") || isZodEmail(".a@b.co") || isZodEmail("a..b@c.co") || isZodEmail("a@b") {
		t.Fatal("zod email")
	}
}

func TestJSTimeJSON(t *testing.T) {
	b, _ := json.Marshal(struct {
		A jsTime `json:"a"`
		B jsTime `json:"b"`
	}{A: jsTime{Time: time.Date(2026, 10, 4, 8, 0, 0, 5_000_000, time.FixedZone("WIB", 7*3600)), Valid: true}, B: jsTime{}})
	if string(b) != `{"a":"2026-10-04T01:00:00.005Z","b":null}` {
		t.Fatal(string(b))
	}
}
