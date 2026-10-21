package gymscheduling

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Gate devices: turnstiles and door readers that scan member QR codes
// without a staff session. Each device belongs to a branch and holds a key
// that staff create, rotate and revoke; only its SHA-256 is stored. The
// device protocol is documented in backend/docs/GATE_DEVICES.md.

const (
	// DeviceKeyHeader carries the device key on the device endpoints.
	DeviceKeyHeader = "X-Gate-Device-Key"
	deviceKeyPrefix = "nhgd_"
	// Scans per device per minute; a turnstile at a busy door stays well
	// below this. Heartbeats get their own budget.
	deviceScanLimit      = 60
	deviceHeartbeatLimit = 12
	deviceLimitWindow    = time.Minute
	defaultRelayOpenMs   = 3000
)

// newDeviceKey returns a fresh key, its hash and the prefix staff see.
func newDeviceKey() (key, hash, prefix string, err error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", "", "", err
	}
	key = deviceKeyPrefix + hex.EncodeToString(raw)
	return key, hashDeviceKey(key), key[:len(deviceKeyPrefix)+6], nil
}

func hashDeviceKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// IssuedDeviceKey is a device key in the clear, returned once on create or rotate.
type IssuedDeviceKey struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	KeyPrefix string `json:"key_prefix"`
}

// NewDeviceInput is a device registration.
type NewDeviceInput struct {
	BranchID, Name string
	RelayOpenMs    int
}

func (s *Service) ListGateDevices(ctx context.Context) ([]*Row, error) {
	return s.repo.ListGateDevices(ctx, s.db)
}

// CreateGateDevice registers a device and returns its key once.
func (s *Service) CreateGateDevice(ctx context.Context, in NewDeviceInput, staff *auth.User, r *http.Request) (out IssuedDeviceKey, err error) {
	key, hash, prefix, err := newDeviceKey()
	if err != nil {
		return out, err
	}
	err = s.inTx(ctx, func(q Q) error {
		id, err := s.repo.InsertGateDevice(ctx, q, NewGateDevice{
			BranchID: in.BranchID, Name: in.Name, KeyHash: hash, KeyPrefix: prefix, RelayOpenMs: in.RelayOpenMs, CreatedBy: &staff.ID,
		})
		if err != nil {
			return err
		}
		out = IssuedDeviceKey{ID: id, Key: key, KeyPrefix: prefix}
		return s.auditDevice(ctx, q, staff, r, "gym.gate_device.create", id, in.Name, prefix)
	})
	return out, err
}

// RotateGateDeviceKey replaces the device key (the old one stops working at
// once), reactivates a revoked device and returns the new key once.
func (s *Service) RotateGateDeviceKey(ctx context.Context, id string, staff *auth.User, r *http.Request) (out IssuedDeviceKey, err error) {
	key, hash, prefix, err := newDeviceKey()
	if err != nil {
		return out, err
	}
	err = s.inTx(ctx, func(q Q) error {
		found, err := s.repo.SetGateDeviceKey(ctx, q, id, hash, prefix)
		if err != nil {
			return err
		}
		if !found {
			return httpx.NotFound("Perangkat gate tidak ditemukan")
		}
		out = IssuedDeviceKey{ID: id, Key: key, KeyPrefix: prefix}
		return s.auditDevice(ctx, q, staff, r, "gym.gate_device.rotate", id, "", prefix)
	})
	return out, err
}

// RevokeGateDevice deactivates the device; its key is refused from now on.
func (s *Service) RevokeGateDevice(ctx context.Context, id string, staff *auth.User, r *http.Request) error {
	return s.inTx(ctx, func(q Q) error {
		found, err := s.repo.RevokeGateDevice(ctx, q, id)
		if err != nil {
			return err
		}
		if !found {
			return httpx.NotFound("Perangkat gate tidak ditemukan")
		}
		return s.auditDevice(ctx, q, staff, r, "gym.gate_device.revoke", id, "", "")
	})
}

// auditDevice records a device change; the key itself is never written.
func (s *Service) auditDevice(ctx context.Context, q Q, staff *auth.User, r *http.Request, action, id, name, keyPrefix string) error {
	after := map[string]any{}
	if keyPrefix != "" {
		after["key_prefix"] = keyPrefix
	}
	return audit.Write(ctx, q, audit.Entry{
		ActorID: staff.ID, ActorName: nullIfEmpty(staff.FullName), Action: action, Entity: "gym.gate_devices",
		EntityID: &id, EntityLabel: nullIfEmpty(name), After: after,
	}.WithRequest(r))
}

// AuthenticateDevice finds the device holding key: 401 for an unknown key,
// 403 for a revoked device.
func (s *Service) AuthenticateDevice(ctx context.Context, key string) (*GateDevice, error) {
	key = strings.TrimSpace(key)
	if !strings.HasPrefix(key, deviceKeyPrefix) {
		return nil, httpx.Unauthorized("Kunci perangkat gate tidak valid")
	}
	device, err := s.repo.GateDeviceByHash(ctx, s.db, hashDeviceKey(key))
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, httpx.Unauthorized("Kunci perangkat gate tidak valid")
	}
	if !device.Active {
		return nil, httpx.Forbidden("Perangkat gate sudah dinonaktifkan")
	}
	return device, nil
}

// DeviceScanResult is what the device acts on: open the relay for
// RelayOpenMs when Allow, and show Display either way.
type DeviceScanResult struct {
	Allow       bool                     `json:"allow"`
	Decision    domain.Decision          `json:"decision"`
	Reason      *domain.GateDenialReason `json:"reason"`
	EntryKind   *domain.GateEntryKind    `json:"entryKind"`
	Display     string                   `json:"display"`
	RelayOpenMs int                      `json:"relayOpenMs"`
	MemberName  *string                  `json:"memberName"`
}

// DeviceScan runs the gate pipeline for a QR the device read, at the
// device's branch, and marks the device as seen.
func (s *Service) DeviceScan(ctx context.Context, device *GateDevice, token string) (DeviceScanResult, error) {
	res, err := s.scan(ctx, token, gatePoint{BranchID: &device.BranchID, DeviceID: &device.ID, Source: "device"})
	if err != nil {
		return DeviceScanResult{}, err
	}
	if err := s.repo.TouchGateDevice(ctx, s.db, device.ID, s.now()); err != nil {
		return DeviceScanResult{}, err
	}
	out := DeviceScanResult{
		Allow: res.Decision == domain.Allowed, Decision: res.Decision, Reason: res.Reason, EntryKind: res.EntryKind,
		MemberName: res.MemberName,
	}
	reason := domain.GateDenialReason("")
	if res.Reason != nil {
		reason = *res.Reason
	}
	out.Display = domain.DeviceDisplay(res.Decision, reason, res.MemberName)
	if out.Allow {
		out.RelayOpenMs = device.RelayOpenMs
	}
	return out, nil
}

// DeviceHeartbeat marks the device as seen and returns its settings.
func (s *Service) DeviceHeartbeat(ctx context.Context, device *GateDevice) (map[string]any, error) {
	now := s.now()
	if err := s.repo.TouchGateDevice(ctx, s.db, device.ID, now); err != nil {
		return nil, err
	}
	return map[string]any{
		"deviceId": device.ID, "name": device.Name, "branchId": device.BranchID, "branchName": device.BranchName,
		"relayOpenMs": device.RelayOpenMs, "serverTime": jsTime(now),
	}, nil
}

// ── Handlers ────────────────────────────────────────────────────────────────

// device guards a device endpoint: the key header, then the per-device rate limit.
func (h *handler) device(limit int, fn func(w http.ResponseWriter, r *http.Request, d *GateDevice) error) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		d, err := h.svc.AuthenticateDevice(r.Context(), r.Header.Get(DeviceKeyHeader))
		if err != nil {
			return err
		}
		window, err := h.limiter.Fixed(r.Context(), "gym-gate-device:"+r.URL.Path+":"+d.ID, limit, deviceLimitWindow, h.svc.now())
		if err != nil {
			return err
		}
		if !window.Allowed {
			retry := max(int(window.ResetAt.Sub(h.svc.now()).Seconds()), 1)
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			return httpx.TooManyRequests("Terlalu banyak scan dari perangkat ini, coba lagi sebentar")
		}
		return fn(w, r, d)
	})
}

func (h *handler) deviceScan(w http.ResponseWriter, r *http.Request, d *GateDevice) error {
	f := form(r)
	token := f.Str("token", validate.Rule{}, validate.StrOpts{Trim: true, Min: 8, Max: 120})
	if err := invalid(f); err != nil {
		return err
	}
	out, err := h.svc.DeviceScan(r.Context(), d, *token)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) deviceHeartbeat(w http.ResponseWriter, r *http.Request, d *GateDevice) error {
	out, err := h.svc.DeviceHeartbeat(r.Context(), d)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) listGateDevices(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListGateDevices(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, rows)
}

func (h *handler) createGateDevice(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := form(r)
	branchID := f.UUID("branch_id", validate.Rule{})
	name := f.Str("name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 2, Max: 80})
	relay := f.Int("relay_open_ms", nullableOptional, between(500, 30000))
	if err := invalid(f); err != nil {
		return err
	}
	in := NewDeviceInput{BranchID: *branchID, Name: *name, RelayOpenMs: defaultRelayOpenMs}
	if relay != nil {
		in.RelayOpenMs = *relay
	}
	out, err := h.svc.CreateGateDevice(r.Context(), in, user, r)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) rotateGateDevice(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.RotateGateDeviceKey(r.Context(), id, user, r)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) revokeGateDevice(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.RevokeGateDevice(r.Context(), id, user, r); err != nil {
		return err
	}
	return httpx.OK(w, object("id", id))
}
