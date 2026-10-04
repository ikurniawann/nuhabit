package hris

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Sections is the hris.sections service the configuration context reaches
// through a port; it runs on the caller's transaction.
func TestSectionsService(t *testing.T) {
	ctx := context.Background()
	tx := testutil.Tx(t)
	var brand string
	if err := tx.QueryRow(ctx, `INSERT INTO item.brands (name) VALUES ($1) RETURNING id::text`, "Go Sections "+testutil.RandomHex(3)).Scan(&brand); err != nil {
		t.Fatal(err)
	}
	created, err := Sections{}.Create(ctx, tx, NewSection{BrandID: brand, Name: "Bar", Code: "BAR", Color: "#6B7280"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(created)
	if !regexp.MustCompile(`^\{"id":"[0-9a-f-]{36}","brand_id":"` + brand + `","name":"Bar","code":"BAR","description":null,"color":"#6B7280","is_active":true,"created_at":"[0-9T:.-]+Z"\}$`).Match(raw) {
		t.Fatalf("created = %s", raw)
	}
	list, err := Sections{}.List(ctx, tx, &brand)
	if err != nil || len(list) != 1 {
		t.Fatalf("list = %v %v", list, err)
	}
	if raw, _ := json.Marshal(list[0]); !regexp.MustCompile(`"brands":\{"name":"Go Sections [0-9a-f]+"\}\}$`).Match(raw) {
		t.Fatalf("listed = %s", raw)
	}
}
