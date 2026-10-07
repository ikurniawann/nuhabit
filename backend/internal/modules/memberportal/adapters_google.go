package memberportal

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// GoogleJWKSURL is where Google publishes the keys that sign ID tokens.
const GoogleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

// googleKeys fetches and caches Google's JWKS. The cache lives as long as
// the Cache-Control max-age says (at least a minute); an unknown key id
// refetches once, which covers key rotation.
type googleKeys struct {
	url    string
	client *http.Client
	now    func() time.Time

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	expires time.Time
}

func newGoogleKeys(url string, client *http.Client, now func() time.Time) *googleKeys {
	return &googleKeys{url: url, client: client, now: now}
}

var maxAgeRe = regexp.MustCompile(`max-age=(\d+)`)

// Key returns the RSA key for kid, nil when Google does not publish it.
func (g *googleKeys) Key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.keys == nil || g.now().After(g.expires) || g.keys[kid] == nil {
		if err := g.refresh(ctx); err != nil {
			return nil, err
		}
	}
	return g.keys[kid], nil
}

func (g *googleKeys) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.url, nil)
	if err != nil {
		return err
	}
	res, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("google jwks: HTTP %d", res.StatusCode)
	}
	var body struct {
		Keys []struct {
			Kty, Kid, N, E string
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range body.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(k.N)
		e, errE := base64.RawURLEncoding.DecodeString(k.E)
		if errN != nil || errE != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	ttl := time.Minute
	if m := maxAgeRe.FindStringSubmatch(res.Header.Get("Cache-Control")); m != nil {
		if secs, err := strconv.Atoi(m[1]); err == nil && time.Duration(secs)*time.Second > ttl {
			ttl = time.Duration(secs) * time.Second
		}
	}
	g.keys, g.expires = keys, g.now().Add(ttl)
	return nil
}
