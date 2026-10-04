package safehttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestBlockedAddresses(t *testing.T) {
	for _, s := range []string{
		"127.0.0.1", "127.8.9.10", "::1", // loopback
		"10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "fd00:ec2::254", // private, AWS IPv6 metadata
		"169.254.169.254", "169.254.0.1", "fe80::1", // link-local, cloud metadata
		"224.0.0.1", "239.255.255.250", "ff02::1", // multicast
		"0.0.0.0", "::", "0.1.2.3", "255.255.255.255",
		"100.100.100.200", "100.64.0.1", // CGNAT, Alibaba metadata
		"::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", // mapped and NAT64 forms
		"198.18.0.1", "240.0.0.1",
	} {
		if !Blocked(netip.MustParseAddr(s)) {
			t.Errorf("%s should be blocked", s)
		}
	}
	for _, s := range []string{"8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "64:ff9b::808:808"} {
		if Blocked(netip.MustParseAddr(s)) {
			t.Errorf("%s should be allowed", s)
		}
	}
}

// fakeDNS answers lookups from a table.
func fakeDNS(table map[string][]string) func(context.Context, string) ([]netip.Addr, error) {
	return func(_ context.Context, host string) ([]netip.Addr, error) {
		var out []netip.Addr
		for _, s := range table[host] {
			out = append(out, netip.MustParseAddr(s))
		}
		if out == nil {
			return nil, errors.New("no such host")
		}
		return out, nil
	}
}

func post(c *http.Client, raw string) error {
	req, err := http.NewRequest(http.MethodPost, raw, strings.NewReader("{}"))
	if err != nil {
		return err
	}
	resp, err := c.Do(req)
	if err == nil {
		resp.Body.Close()
	}
	return err
}

func TestClientRefusesPrivateDestinations(t *testing.T) {
	p := Policy{LookupIP: fakeDNS(map[string][]string{
		"metadata.test": {"169.254.169.254"},
		"mixed.test":    {"93.184.216.34", "10.0.0.5"}, // every resolved address must be public
		"loop.test":     {"127.0.0.1"},
	})}
	c := p.Client(time.Second)
	for _, raw := range []string{
		"https://metadata.test/latest/meta-data",
		"https://mixed.test/hook",
		"https://loop.test/hook",
		"https://127.0.0.1/hook",
		"https://[::1]/hook",
		"https://169.254.169.254/",
		"http://93.184.216.34/hook", // plain http
		"ftp://93.184.216.34/x",
	} {
		if err := post(c, raw); !errors.Is(err, ErrBlocked) {
			t.Errorf("%s: err = %v, want ErrBlocked", raw, err)
		}
	}
}

func TestAllowlistAndRedirects(t *testing.T) {
	var hits []string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, "target")
	}))
	defer target.Close()
	front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, "front")
		http.Redirect(w, r, target.URL+"/landed", http.StatusTemporaryRedirect)
	}))
	defer front.Close()
	frontHost := strings.TrimPrefix(front.URL, "http://")

	// Without an allowlist the loopback test server is refused outright.
	if err := post(Policy{}.Client(time.Second), front.URL); !errors.Is(err, ErrBlocked) {
		t.Fatalf("loopback without allowlist: %v", err)
	}
	// host:port in the allowlist admits http and the private address, but
	// a redirect to another (unlisted) private address is refused.
	c := Policy{AllowHosts: []string{frontHost}}.Client(time.Second)
	if err := post(c, front.URL); !errors.Is(err, ErrBlocked) {
		t.Fatalf("redirect to a private address: %v", err)
	}
	if strings.Join(hits, ",") != "front" {
		t.Fatalf("hits = %v", hits)
	}
	hits = nil
	c = Policy{AllowHosts: []string{frontHost, strings.TrimPrefix(target.URL, "http://")}}.Client(time.Second)
	if err := post(c, front.URL); err != nil || strings.Join(hits, ",") != "front,target" {
		t.Fatalf("both allowlisted: %v %v", err, hits)
	}
}

func TestFromEnv(t *testing.T) {
	p := FromEnv(func(k string) string {
		if k == "SAFEHTTP_ALLOW_HOSTS" {
			return " hooks.internal:8080, LOCALHOST ,,"
		}
		return ""
	})
	for _, c := range []struct {
		raw  string
		want bool
	}{
		{"http://hooks.internal:8080/x", true},
		{"http://hooks.internal:9090/x", false},
		{"http://localhost:11434/v1", true},
		{"http://example.com/x", false},
	} {
		u, _ := url.Parse(c.raw)
		if got := p.CheckURL(u) == nil; got != c.want {
			t.Errorf("CheckURL(%s) allowed = %v, want %v", c.raw, got, c.want)
		}
	}
}
