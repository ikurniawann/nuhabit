package gymscheduling

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
)

// GateRepository is the persistence of open gym, staff corrections and gate
// devices (gym.open_gym_hours, gym.gate_devices).
type GateRepository interface {
	// OpenGymHours lists the branch's weekly open gym hours.
	OpenGymHours(ctx context.Context, q Q, branchID string) ([]domain.OpenHours, error)
	// ReplaceOpenGymHours sets the branch's weekly hours; nil clears them.
	ReplaceOpenGymHours(ctx context.Context, q Q, branchID string, hours []domain.OpenHours, by string) error
	// EnteredOpenGymSince reports an allowed open gym entry since the instant.
	EnteredOpenGymSince(ctx context.Context, q Q, customerID string, since time.Time) (bool, error)

	// ChargedAmount sums the credits deducted under the idempotency key,
	// split entries (key#n) included.
	ChargedAmount(ctx context.Context, q Q, key string) (int, error)
	// ReopenBooking sets a checked-in or no-show booking back to confirmed,
	// clears its check-in and pass strike, and counts the correction. It
	// reports whether a pass strike was cleared.
	ReopenBooking(ctx context.Context, q Q, id string) (bool, error)

	InsertGateDevice(ctx context.Context, q Q, d NewGateDevice) (string, error)
	ListGateDevices(ctx context.Context, q Q) ([]*Row, error)
	// GateDeviceByHash returns nil when no device has the key hash.
	GateDeviceByHash(ctx context.Context, q Q, keyHash string) (*GateDevice, error)
	// SetGateDeviceKey stores a new key and makes the device active again;
	// false when the device does not exist.
	SetGateDeviceKey(ctx context.Context, q Q, id, keyHash, keyPrefix string) (bool, error)
	// RevokeGateDevice deactivates the device; false when it does not exist.
	RevokeGateDevice(ctx context.Context, q Q, id string) (bool, error)
	TouchGateDevice(ctx context.Context, q Q, id string, at time.Time) error
}

// NewGateDevice is a device registration with its hashed key.
type NewGateDevice struct {
	BranchID, Name, KeyHash, KeyPrefix string
	RelayOpenMs                        int
	CreatedBy                          *string
}

// GateDevice is a device as the device endpoints see it.
type GateDevice struct {
	ID, BranchID, Name string
	BranchName         *string
	RelayOpenMs        int
	Active             bool
}

func (Postgres) OpenGymHours(ctx context.Context, q Q, branchID string) ([]domain.OpenHours, error) {
	rows, err := q.Query(ctx, `SELECT weekday,
            (extract(hour FROM opens_at) * 60 + extract(minute FROM opens_at))::int,
            (extract(hour FROM closes_at) * 60 + extract(minute FROM closes_at))::int
       FROM gym.open_gym_hours WHERE branch_id = $1 ORDER BY weekday`, branchID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.OpenHours, error) {
		var h domain.OpenHours
		return h, r.Scan(&h.Weekday, &h.Opens, &h.Closes)
	})
}

func (Postgres) ReplaceOpenGymHours(ctx context.Context, q Q, branchID string, hours []domain.OpenHours, by string) error {
	if _, err := q.Exec(ctx, `DELETE FROM gym.open_gym_hours WHERE branch_id = $1`, branchID); err != nil {
		return err
	}
	for _, h := range hours {
		if _, err := q.Exec(ctx, `INSERT INTO gym.open_gym_hours (branch_id, weekday, opens_at, closes_at, updated_by)
		    VALUES ($1, $2, make_time($3 / 60, $3 % 60, 0), make_time($4 / 60, $4 % 60, 0), $5)`,
			branchID, h.Weekday, h.Opens, h.Closes, by); err != nil {
			return err
		}
	}
	return nil
}

func (Postgres) EnteredOpenGymSince(ctx context.Context, q Q, customerID string, since time.Time) (bool, error) {
	var entered bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.access_logs
      WHERE customer_id = $1 AND decision = 'allowed' AND entry_kind = 'open_gym' AND created_at >= $2)`,
		customerID, since).Scan(&entered)
	return entered, err
}

func (Postgres) ChargedAmount(ctx context.Context, q Q, key string) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT COALESCE(-sum(amount), 0)::int FROM gym.credit_ledger
      WHERE amount < 0 AND (idempotency_key = $1 OR starts_with(idempotency_key, $1 || '#'))`, key).Scan(&n)
	return n, err
}

func (Postgres) ReopenBooking(ctx context.Context, q Q, id string) (bool, error) {
	var hadStrike bool
	err := q.QueryRow(ctx, `WITH old AS (SELECT pass_strike FROM gym.bookings WHERE id = $1)
     UPDATE gym.bookings
        SET status = 'confirmed', checked_in_at = NULL, pass_strike = false, pass_strike_at = NULL,
            correction_seq = correction_seq + 1, updated_at = now()
      WHERE id = $1
      RETURNING (SELECT COALESCE(pass_strike, false) FROM old)`, id).Scan(&hadStrike)
	return hadStrike, err
}

func (Postgres) InsertGateDevice(ctx context.Context, q Q, d NewGateDevice) (string, error) {
	return returningID(ctx, q, `INSERT INTO gym.gate_devices (branch_id, name, key_hash, key_prefix, relay_open_ms, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, d.BranchID, d.Name, d.KeyHash, d.KeyPrefix, d.RelayOpenMs, d.CreatedBy)
}

func (Postgres) ListGateDevices(ctx context.Context, q Q) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT d.id, d.branch_id, b.name AS branch_name, d.name, d.key_prefix, d.relay_open_ms, d.active,
            d.last_seen_at, d.created_at, d.rotated_at, d.revoked_at
       FROM gym.gate_devices d
       LEFT JOIN configuration.branches b ON b.id = d.branch_id
      ORDER BY d.active DESC, b.name, d.name`)
}

func (Postgres) GateDeviceByHash(ctx context.Context, q Q, keyHash string) (*GateDevice, error) {
	var d GateDevice
	err := q.QueryRow(ctx, `SELECT d.id, d.branch_id, b.name, d.name, d.relay_open_ms, d.active
       FROM gym.gate_devices d LEFT JOIN configuration.branches b ON b.id = d.branch_id
      WHERE d.key_hash = $1`, keyHash).Scan(&d.ID, &d.BranchID, &d.BranchName, &d.Name, &d.RelayOpenMs, &d.Active)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &d, err
}

func (Postgres) SetGateDeviceKey(ctx context.Context, q Q, id, keyHash, keyPrefix string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE gym.gate_devices
        SET key_hash = $2, key_prefix = $3, active = true, rotated_at = now(), revoked_at = NULL, updated_at = now()
      WHERE id = $1`, id, keyHash, keyPrefix)
	return tag.RowsAffected() == 1, err
}

func (Postgres) RevokeGateDevice(ctx context.Context, q Q, id string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE gym.gate_devices SET active = false, revoked_at = now(), updated_at = now() WHERE id = $1`, id)
	return tag.RowsAffected() == 1, err
}

func (Postgres) TouchGateDevice(ctx context.Context, q Q, id string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE gym.gate_devices SET last_seen_at = $2 WHERE id = $1`, id, at)
	return err
}
