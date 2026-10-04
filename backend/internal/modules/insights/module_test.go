package insights

import (
	"path/filepath"
	"testing"
)

// The markdown log lands where Next writes it:
// <STORAGE_DIR>/assistant-memory, by default the frontend's storage.
func TestAssistantMemoryDir(t *testing.T) {
	env := map[string]string{"STORAGE_DIR": "/app/storage"}
	if got := assistantMemoryDir(func(k string) string { return env[k] }); got != "/app/storage/assistant-memory" {
		t.Fatal(got)
	}
	want, _ := filepath.Abs("../../../../frontend/storage/assistant-memory")
	if got := assistantMemoryDir(func(string) string { return "" }); got != want {
		t.Fatal(got, want)
	}
}
