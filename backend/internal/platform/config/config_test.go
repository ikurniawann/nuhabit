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
