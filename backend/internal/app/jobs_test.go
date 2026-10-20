package app

import (
	"slices"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/config"
	"nuhabit/backend/internal/platform/module"
)

func jobNames(modules string) map[string]time.Duration {
	out := map[string]time.Duration{}
	for _, j := range Jobs(module.Deps{Now: time.Now, Config: config.Config{Modules: modules}}) {
		if j.Run == nil {
			panic(j.Name + " has no run function")
		}
		out[j.Name] = j.Every
	}
	return out
}

func TestJobsFollowMountedModules(t *testing.T) {
	all := jobNames("all")
	want := map[string]time.Duration{
		"gym-credits.purchase-reconcile": 2 * time.Minute,
		"gym-credits.reminders":          time.Hour,
		"gym-scheduling.class-reminders": 5 * time.Minute,
	}
	for name, every := range want {
		if all[name] != every {
			t.Errorf("%s every %s, want %s", name, all[name], every)
		}
	}
	credits := jobNames("gym-credits")
	names := make([]string, 0, len(credits))
	for n := range credits {
		names = append(names, n)
	}
	slices.Sort(names)
	if !slices.Equal(names, []string{"gym-credits.purchase-reconcile", "gym-credits.reminders"}) {
		t.Fatalf("MODULES=gym-credits jobs = %v", names)
	}
}
