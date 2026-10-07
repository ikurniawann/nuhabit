package domain

// Fields is a parsed PATCH body as a JS object: keys in schema order, a key
// present only when the client sent it (nil value = null).
type Fields struct {
	keys []string
	vals map[string]any
}

// NewFields returns an empty object.
func NewFields() *Fields { return &Fields{vals: map[string]any{}} }

// Set adds or replaces a key (an existing key keeps its position).
func (f *Fields) Set(key string, v any) {
	if _, ok := f.vals[key]; !ok {
		f.keys = append(f.keys, key)
	}
	f.vals[key] = v
}

// Has reports whether the key is present (undefined otherwise).
func (f *Fields) Has(key string) bool { _, ok := f.vals[key]; return ok }

// Get returns the value (nil when absent or null).
func (f *Fields) Get(key string) any { return f.vals[key] }

// Keys lists the present keys in order.
func (f *Fields) Keys() []string { return append([]string(nil), f.keys...) }

// Each visits the present keys in order.
func (f *Fields) Each(fn func(key string, v any)) {
	for _, k := range f.keys {
		fn(k, f.vals[k])
	}
}

// StageMoveError is a 400 raised by PlanStageMove.
type StageMoveError string

func (e StageMoveError) Error() string { return string(e) }

// PlanStageMove is planStageMove: a won stage needs a final value and an
// event date (the date becomes fixed, the lost reason is dropped), a lost
// stage needs a reason, an open stage clears closed_at and the reason. The
// forecast category follows the stage unless the body overrides it. body is
// updated in place; the returned columns go into the SET clause first.
func PlanStageMove(stage StageFlags, body *Fields, currentValueFinal, currentEventDate any, nowISO string) (*Fields, error) {
	columns := NewFields()
	if !body.Has("forecast_category") {
		columns.Set("forecast_category", CategoryFromStage(stage))
	}
	switch {
	case stage.IsWon:
		finalValue := currentValueFinal
		if body.Has("value_final") {
			finalValue = body.Get("value_final")
		}
		eventDate := currentEventDate
		if body.Has("event_date") {
			eventDate = body.Get("event_date")
		}
		if finalValue == nil {
			return nil, StageMoveError("Deal Menang wajib diisi nilai final")
		}
		if eventDate == nil || eventDate == "" {
			return nil, StageMoveError("Deal Menang wajib punya tanggal acara fix")
		}
		body.Set("is_event_date_fixed", true)
		body.Set("lost_reason_id", nil)
		columns.Set("closed_at", nowISO)
	case stage.IsLost:
		if v, _ := body.Get("lost_reason_id").(string); v == "" {
			return nil, StageMoveError("Deal Kalah wajib pilih alasan kalah")
		}
		columns.Set("closed_at", nowISO)
	default:
		body.Set("lost_reason_id", nil)
		columns.Set("closed_at", nil)
	}
	columns.Set("entered_stage_at", nowISO)
	return columns, nil
}

// EventTypeMessageLabels is EVENT_TYPE_MESSAGE_LABELS (lower case, inside a
// WhatsApp sentence).
var EventTypeMessageLabels = map[string]string{
	"gathering": "gathering", "field-trip": "field trip", "ulang-tahun": "acara ulang tahun",
	"buyout-venue": "buyout venue", "lainnya": "acara",
}
