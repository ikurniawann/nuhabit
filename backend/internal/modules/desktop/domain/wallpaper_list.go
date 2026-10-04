package domain

import (
	"regexp"
	"strconv"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/validate"
)

// Uploaded wallpaper limits (lib/desktop/wallpapers.ts).
const (
	WallpaperMaxBytes = 8 * 1024 * 1024
	WallpaperMaxItems = 24
	wallpaperNameMax  = 60
)

var (
	fileExtension = regexp.MustCompile(`(?i)\.[a-z0-9]+$`)
	nameSeparator = regexp.MustCompile(`[_-]+`)
)

// sliceUTF16 is s.slice(0, n) on UTF-16 code units.
func sliceUTF16(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

// NormalizeWallpaperName is normalizeWallpaperName: the admin's name, else
// the file name without its extension and with _ and - as spaces.
func NormalizeWallpaperName(input, fileName string) string {
	if v := validate.JSTrim(input); v != "" {
		return sliceUTF16(v, wallpaperNameMax)
	}
	base := validate.JSTrim(nameSeparator.ReplaceAllString(fileExtension.ReplaceAllString(fileName, ""), " "))
	if base == "" {
		base = "Wallpaper"
	}
	return sliceUTF16(base, wallpaperNameMax)
}

// AddWallpaper is addDesktopWallpaper: next goes first, unless the list is
// full or the id is taken ("" error means ok).
func AddWallpaper(items []Wallpaper, next Wallpaper) ([]Wallpaper, string) {
	if len(items) >= WallpaperMaxItems {
		return nil, "Maksimal " + strconv.Itoa(WallpaperMaxItems) + " wallpaper — hapus yang lama dulu"
	}
	for _, it := range items {
		if it.ID == next.ID {
			return nil, "ID wallpaper sudah dipakai"
		}
	}
	return append([]Wallpaper{next}, items...), ""
}

// RemoveWallpaper is removeDesktopWallpaper.
func RemoveWallpaper(items []Wallpaper, id string) ([]Wallpaper, *Wallpaper) {
	rest := []Wallpaper{}
	var removed *Wallpaper
	for i, it := range items {
		if it.ID != id {
			rest = append(rest, it)
		} else if removed == nil {
			removed = &items[i]
		}
	}
	return rest, removed
}
