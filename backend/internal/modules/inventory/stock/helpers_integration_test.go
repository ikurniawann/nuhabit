package stock_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/modules/inventory/stock"
	"nuhabit/backend/internal/platform/database"
)

// Integration tests run against TEST_DATABASE_URL inside one rolled-back
// transaction (kittest). Ports are in-memory doubles; the SQL adapters live
// in internal/app.

type fakeProcurement map[string]stock.LastPurchase

func (f fakeProcurement) LastPurchases(_ context.Context, _ database.Querier, ids []string) (map[string]stock.LastPurchase, error) {
	out := map[string]stock.LastPurchase{}
	for _, id := range ids {
		if lp, ok := f[id]; ok {
			out[id] = lp
		}
	}
	return out, nil
}

type fakeSkus struct {
	byProduct map[string][]stock.Sku
	qty       map[string]float64
}

func (f *fakeSkus) ActiveSkus(_ context.Context, _ database.Querier, ids []string) (map[string][]stock.Sku, error) {
	out := map[string][]stock.Sku{}
	for _, id := range ids {
		if s, ok := f.byProduct[id]; ok {
			out[id] = s
		}
	}
	return out, nil
}

func (f *fakeSkus) LockSkuStock(_ context.Context, _ database.Querier, id string) (float64, bool, error) {
	q, ok := f.qty[id]
	return q, ok, nil
}

func (f *fakeSkus) SetSkuStock(_ context.Context, _ database.Querier, id string, qty float64) error {
	f.qty[id] = qty
	return nil
}

func (f *fakeSkus) SkuLabels(_ context.Context, _ database.Querier, ids []string) (map[string]stock.Sku, error) {
	out := map[string]stock.Sku{}
	for _, list := range f.byProduct {
		for _, s := range list {
			out[s.ID] = s
		}
	}
	return out, nil
}

// recordingJournals captures journal requests and answers with note.
type recordingJournals struct {
	note        *string
	opnames     []stock.OpnameJournal
	adjustments []stock.AdjustmentJournal
	transfers   []stock.TransferJournal
}

func (j *recordingJournals) PostStockOpname(_ context.Context, _ database.Querier, in stock.OpnameJournal) (*string, error) {
	j.opnames = append(j.opnames, in)
	return j.note, nil
}

func (j *recordingJournals) PostStockAdjustment(_ context.Context, _ database.Querier, in stock.AdjustmentJournal) (*string, error) {
	j.adjustments = append(j.adjustments, in)
	return j.note, nil
}

func (j *recordingJournals) PostStockTransfer(_ context.Context, _ database.Querier, in stock.TransferJournal) (*string, error) {
	j.transfers = append(j.transfers, in)
	return j.note, nil
}

type env struct {
	*kittest.T
	org      kittest.Org
	skus     *fakeSkus
	journals *recordingJournals
	procure  fakeProcurement
	unitKg   string
	unitGr   string
}

var fixedNow = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)

func setup(t *testing.T) *env {
	t.Helper()
	k := kittest.Setup(t, kittest.Menus, func() time.Time { return fixedNow })
	e := &env{T: k, org: k.NewOrg(), skus: &fakeSkus{byProduct: map[string][]stock.Sku{}, qty: map[string]float64{}},
		journals: &recordingJournals{}, procure: fakeProcurement{}}
	e.unitKg = k.Unit("KG", "Kilogram")
	e.unitGr = k.Unit("GR", "Gram")
	k.Mount(stock.Routes(k.Env, stock.Ports{Procurement: e.procure, PosSkus: e.skus, Journals: e.journals}))
	return e
}

func (e *env) list(out map[string]any, key string) []any {
	e.Helper()
	v, ok := out[key].([]any)
	if !ok {
		e.Fatalf("%s is not a list: %v", key, out[key])
	}
	return v
}

func obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func (e *env) jsonEq(got any, want string) {
	e.Helper()
	b, _ := json.Marshal(got)
	var a, w any
	_ = json.Unmarshal(b, &a)
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		e.Fatalf("bad want json: %v", err)
	}
	ab, _ := json.Marshal(a)
	wb, _ := json.Marshal(w)
	if string(ab) != string(wb) {
		e.Fatalf("json mismatch\n got: %s\nwant: %s", ab, wb)
	}
}

func (e *env) num(sql string, args ...any) float64 {
	e.Helper()
	var f float64
	e.Scalar(&f, sql, args...)
	return f
}
