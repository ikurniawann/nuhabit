package httpx

import "time"

// JSTimeLayout is Date.prototype.toISOString: UTC, milliseconds, "Z".
const JSTimeLayout = "2006-01-02T15:04:05.000Z"

// JSTime marshals like a JS Date in NextResponse.json, which is how
// node-postgres returns timestamptz (and date) columns. Use *JSTime for
// nullable columns so NULL stays null.
type JSTime time.Time

// MarshalJSON writes the toISOString form.
func (t JSTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format(JSTimeLayout) + `"`), nil
}

// NewJSTime converts a nullable time; nil stays nil.
func NewJSTime(t *time.Time) *JSTime {
	if t == nil {
		return nil
	}
	v := JSTime(*t)
	return &v
}
