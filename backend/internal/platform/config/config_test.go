package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotenvPrecedence(t *testing.T) {
	dir := t.TempDir()
	local := filepath.Join(dir, ".env.local")
	base := filepath.Join(dir, ".env")
	_ = os.WriteFile(local, []byte("# c\nA=local\nB=\"quoted\"\nexport C='single'\n"), 0o644)
	_ = os.WriteFile(base, []byte("A=base\nD=base\nbroken\n"), 0o644)
	t.Setenv("C", "shell")
	for _, k := range []string{"A", "B", "D"} {
		k := k
		old, had := os.LookupEnv(k)
		_ = os.Unsetenv(k)
		t.Cleanup(func() {
			if had {
				_ = os.Setenv(k, old)
			} else {
				_ = os.Unsetenv(k)
			}
		})
	}
	LoadDotenv(local, base)
	want := map[string]string{"A": "local", "B": "quoted", "C": "shell", "D": "base"}
	for k, v := range want {
		if got := os.Getenv(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func TestLoadDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("MIGRATE_DATABASE_URL", "postgres://x@localhost/db")
	t.Setenv("PORT", "")
	t.Setenv("MODULES", "")
	t.Setenv("APP_ENV", "")
	t.Setenv("NODE_ENV", "production")
	c := Load()
	if c.DatabaseURL != "postgres://x@localhost/db" || c.Port != "8080" || c.Modules != "all" || !c.IsProduction() {
		t.Fatalf("%+v", c)
	}
}

func TestValidate(t *testing.T) {
	for url, ok := range map[string]bool{
		"postgres://u@h:5432/db":   true,
		"postgresql://u:p@h/db":    true,
		"":                         false,
		"mysql://u@h/db":           false,
		"postgres://with space/db": false,
	} {
		if err := (Config{DatabaseURL: url}).Validate(); (err == nil) != ok {
			t.Errorf("Validate(%q) = %v, want ok=%v", url, err, ok)
		}
	}
}

func TestDisabledIntegrations(t *testing.T) {
	all := DisabledIntegrations(func(string) string { return "" })
	if len(all) != 5 {
		t.Fatalf("empty env: %v", all)
	}
	env := map[string]string{
		"NEXT_PUBLIC_BASE_URL": "https://x", "RESEND_API_KEY": "k", "XENDIT_MOCK": "1",
		"VAPID_PUBLIC_KEY": "a", "VAPID_PRIVATE_KEY": "b", "PUBLIC_ORIGIN": "http://next:3000",
	}
	if off := DisabledIntegrations(func(k string) string { return env[k] }); len(off) != 0 {
		t.Fatalf("configured env: %v", off)
	}
}
