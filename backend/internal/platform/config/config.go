// Package config reads process settings from the environment.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// Config is the runtime configuration shared by every module.
type Config struct {
	// DatabaseURL is the runtime connection string. It falls back to
	// MIGRATE_DATABASE_URL so a single local .env.local serves both binaries.
	DatabaseURL string
	Port        string
	// Modules is the raw MODULES value: "all" or a comma-separated list.
	Modules string
	// AppEnv is "development", "test" or "production".
	AppEnv   string
	TimeZone string
}

// IsProduction reports whether APP_ENV (or NODE_ENV) says production.
func (c Config) IsProduction() bool { return c.AppEnv == "production" }

// ModuleEnabled reports whether a module name is selected by MODULES.
func (c Config) ModuleEnabled(name string) bool {
	raw := strings.TrimSpace(c.Modules)
	if raw == "" || raw == "all" {
		return true
	}
	for _, part := range strings.Split(raw, ",") {
		if strings.TrimSpace(part) == name {
			return true
		}
	}
	return false
}

// Load reads the configuration from the environment. Call LoadDotenv first
// when running from a source checkout.
func Load() Config {
	appEnv := firstNonEmpty(os.Getenv("APP_ENV"), os.Getenv("NODE_ENV"), "development")
	return Config{
		DatabaseURL: firstNonEmpty(os.Getenv("DATABASE_URL"), os.Getenv("MIGRATE_DATABASE_URL")),
		Port:        firstNonEmpty(os.Getenv("PORT"), "8080"),
		Modules:     firstNonEmpty(os.Getenv("MODULES"), "all"),
		AppEnv:      appEnv,
		TimeZone:    firstNonEmpty(os.Getenv("TZ"), "Asia/Jakarta"),
	}
}

// LoadDotenv loads KEY=VALUE files into the process environment. Earlier
// files win over later ones and the shell environment wins over all files,
// matching apply-migrations.js (.env.local, then .env, then the shell).
func LoadDotenv(paths ...string) {
	for _, p := range paths {
		f, err := os.Open(filepath.Clean(p))
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			key, value, ok := parseDotenvLine(sc.Text())
			if !ok {
				continue
			}
			if _, exists := os.LookupEnv(key); !exists {
				_ = os.Setenv(key, value)
			}
		}
		_ = f.Close()
	}
}

func parseDotenvLine(line string) (string, string, bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")
	key, value, ok := strings.Cut(line, "=")
	if !ok {
		return "", "", false
	}
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)
	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
		value = value[1 : len(value)-1]
	}
	return key, value, key != ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
