// Package safehttp sends requests to URLs that users or settings supply
// (workflow webhooks, push endpoints, API base URLs) without letting them
// reach the server's own network. A Policy client:
//
//   - accepts only https, on every request and every redirect hop;
//   - resolves the host itself, refuses the request when any resolved
//     address is loopback, private, link-local (cloud metadata), multicast,
//     unspecified or otherwise reserved, and dials the vetted address, so a
//     DNS answer cannot change between the check and the connect;
//   - ignores HTTP(S)_PROXY, which would hide the real destination.
//
// SAFEHTTP_ALLOW_HOSTS lists host or host:port entries (comma separated)
// exempt from both rules, for an internal receiver an operator trusts.
package safehttp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"
)

// ErrBlocked wraps every refusal.
var ErrBlocked = errors.New("safehttp: destination not allowed")

// Policy decides which destinations a client may reach.
type Policy struct {
	// AllowHosts are lower-case "host" or "host:port" entries that may use
	// http and resolve to any address.
	AllowHosts []string
	// LookupIP resolves a host name; nil uses net.DefaultResolver.
	LookupIP func(ctx context.Context, host string) ([]netip.Addr, error)
}

// FromEnv reads SAFEHTTP_ALLOW_HOSTS through getenv (os.Getenv when nil).
func FromEnv(getenv func(string) string) Policy {
	if getenv == nil {
		getenv = os.Getenv
	}
	var p Policy
	for _, h := range strings.Split(getenv("SAFEHTTP_ALLOW_HOSTS"), ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			p.AllowHosts = append(p.AllowHosts, h)
		}
	}
	return p
}

// NewClient is FromEnv(os.Getenv).Client(timeout).
func NewClient(timeout time.Duration) *http.Client { return FromEnv(nil).Client(timeout) }

func (p Policy) allowlisted(host, port string) bool {
	host = strings.ToLower(host)
	return slices.Contains(p.AllowHosts, host) || slices.Contains(p.AllowHosts, net.JoinHostPort(host, port))
}

// CheckURL refuses any scheme but https unless the host is allowlisted.
func (p Policy) CheckURL(u *url.URL) error {
	if u.Scheme == "https" || (u.Scheme == "http" && p.allowlisted(u.Hostname(), portOf(u))) {
		return nil
	}
	return fmt.Errorf("%w: scheme %q", ErrBlocked, u.Scheme)
}

func portOf(u *url.URL) string {
	if port := u.Port(); port != "" {
		return port
	}
	if u.Scheme == "http" {
		return "80"
	}
	return "443"
}

// Client returns an http.Client that enforces the policy; timeout 0 means
// none.
func (p Policy) Client(timeout time.Duration) *http.Client {
	transport := &http.Transport{
		DialContext:           p.dial,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
	return &http.Client{Timeout: timeout, Transport: checkedTransport{p, transport}}
}

// checkedTransport checks the scheme of every request, redirects included.
type checkedTransport struct {
	p    Policy
	next http.RoundTripper
}

func (t checkedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if err := t.p.CheckURL(req.URL); err != nil {
		return nil, err
	}
	return t.next.RoundTrip(req)
}

var dialer = &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}

// dial resolves addr, refuses it when any address is blocked, then dials
// the vetted addresses in order.
func (p Policy) dial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	if p.allowlisted(host, port) {
		return dialer.DialContext(ctx, network, addr)
	}
	ips, err := p.resolve(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if Blocked(ip) {
			return nil, fmt.Errorf("%w: %s resolves to %s", ErrBlocked, host, ip)
		}
	}
	var lastErr error
	for _, ip := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func (p Policy) resolve(ctx context.Context, host string) ([]netip.Addr, error) {
	if ip, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{ip}, nil
	}
	lookup := p.LookupIP
	if lookup == nil {
		lookup = func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		}
	}
	ips, err := lookup(ctx, host)
	if err == nil && len(ips) == 0 {
		err = fmt.Errorf("safehttp: %s has no addresses", host)
	}
	return ips, err
}

var (
	nat64 = netip.MustParsePrefix("64:ff9b::/96")
	// reserved are blocked ranges that netip's predicates do not cover.
	reserved = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),     // "this network"
		netip.MustParsePrefix("100.64.0.0/10"), // carrier-grade NAT, Alibaba metadata
		netip.MustParsePrefix("192.0.0.0/24"),  // IETF protocol assignments
		netip.MustParsePrefix("198.18.0.0/15"), // benchmarking
		netip.MustParsePrefix("240.0.0.0/4"),   // reserved, broadcast
		netip.MustParsePrefix("2002::/16"),     // 6to4 can tunnel to any IPv4
	}
)

// Blocked reports whether a request must not reach ip.
func Blocked(ip netip.Addr) bool {
	ip = ip.Unmap()
	if nat64.Contains(ip) {
		b := ip.As16()
		return Blocked(netip.AddrFrom4([4]byte(b[12:])))
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return true
	}
	for _, p := range reserved {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}
