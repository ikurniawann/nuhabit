package domain

import (
	"strings"
	"testing"
)

func TestNormalizeWallpaperName(t *testing.T) {
	for _, c := range []struct{ input, file, want string }{
		{"  Pantai  ", "x.png", "Pantai"},
		{"", "pantai_senja--01.JPG", "pantai senja 01"},
		{"", ".png", "Wallpaper"},
		{"", "__", "Wallpaper"},
		{strings.Repeat("é", 70), "x.png", strings.Repeat("é", 60)},
		{strings.Repeat("a", 59) + "😀", "x.png", strings.Repeat("a", 59) + "�"},
	} {
		if got := NormalizeWallpaperName(c.input, c.file); got != c.want {
			t.Errorf("NormalizeWallpaperName(%q, %q) = %q, want %q", c.input, c.file, got, c.want)
		}
	}
}

func TestAddRemoveWallpaper(t *testing.T) {
	items := []Wallpaper{{ID: "a"}, {ID: "b"}}
	if _, msg := AddWallpaper(items, Wallpaper{ID: "a"}); msg != "ID wallpaper sudah dipakai" {
		t.Fatalf("duplicate: %q", msg)
	}
	next, msg := AddWallpaper(items, Wallpaper{ID: "c"})
	if msg != "" || len(next) != 3 || next[0].ID != "c" {
		t.Fatalf("add: %v %q", next, msg)
	}
	rest, removed := RemoveWallpaper(next, "a")
	if removed == nil || removed.ID != "a" || len(rest) != 2 {
		t.Fatalf("remove: %v %v", rest, removed)
	}
	if _, removed := RemoveWallpaper(next, "zz"); removed != nil {
		t.Fatal("removed a missing id")
	}
}
