// Package domain holds the pure gym-training rules: the HYROX exercise
// library and workout generator, the active workout session state machine,
// race prediction and readiness, coach incentive statements and the payout
// state machine. It imports only the standard library.
//
// Ported from frontend/src/lib/gym/{hyrox,races,incentive}.ts and
// frontend/src/lib/member-app/workout.ts. Numbers follow JavaScript semantics
// where the TypeScript relied on them (Math.round, Date millisecond precision).
package domain

import (
	"fmt"
	"math"
	"time"
)

// jsRound mirrors Math.round: halves round towards +Infinity.
func jsRound(x float64) int { return int(math.Floor(x + 0.5)) }

// isoLayout is Date.prototype.toISOString.
const isoLayout = "2006-01-02T15:04:05.000Z"

// ISO formats t like Date.prototype.toISOString (UTC, milliseconds).
func ISO(t time.Time) string { return t.UTC().Truncate(time.Millisecond).Format(isoLayout) }

// Timestamp is a time that serializes like a JavaScript Date in JSON
// (toISOString). node-pg returns timestamptz columns as Date, so every
// timestamp the TS routes returned has this shape. It also implements
// sql.Scanner so repositories can scan straight into it.
type Timestamp struct{ time.Time }

// At wraps t, truncated to milliseconds like a JavaScript Date.
func At(t time.Time) Timestamp { return Timestamp{t.Truncate(time.Millisecond)} }

// MarshalJSON renders "2026-10-04T08:00:00.000Z".
func (t Timestamp) MarshalJSON() ([]byte, error) { return []byte(`"` + ISO(t.Time) + `"`), nil }

// Scan reads a timestamptz value.
func (t *Timestamp) Scan(src any) error {
	v, ok := src.(time.Time)
	if !ok {
		return fmt.Errorf("domain.Timestamp: cannot scan %T", src)
	}
	*t = At(v)
	return nil
}

func millis(t time.Time) int64 { return t.UnixMilli() }
