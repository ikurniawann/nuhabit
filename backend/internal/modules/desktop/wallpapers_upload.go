package desktop

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net/http"
	"strconv"

	"nuhabit/backend/internal/modules/desktop/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// POST and DELETE /api/desktop/wallpapers: the list lives in
// configuration.app_settings (desktop_wallpapers), the images in the public
// "desktop-wallpapers" bucket.

const (
	wallpapersKey    = "desktop_wallpapers"
	wallpapersBucket = "desktop-wallpapers"
)

// WallpaperSettings reads and writes the wallpaper list setting.
type WallpaperSettings interface {
	Setting(ctx context.Context, key string) (*string, error)
	SaveSetting(ctx context.Context, key, value string) error
}

// SaveSetting is setSetting with a non-null value.
func (p *Postgres) SaveSetting(ctx context.Context, key, value string) error {
	_, err := p.db.Exec(ctx, `INSERT INTO configuration.app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}

// requireAppearance is requireIamMenuPrefix(IAM.settingsAppearance).
func (h handlers) requireAppearance(r *http.Request) (*auth.User, error) {
	user, err := h.svc.users.RequireUser(r)
	if err != nil {
		return nil, err
	}
	granted, err := h.svc.users.GrantedMenuCodes(r.Context(), user.ID, user.Role)
	if err != nil {
		return nil, err
	}
	if !iam.HasAnyMenuPrefix(granted, iam.SettingsAppearance) {
		return nil, httpx.Forbidden("Insufficient permissions")
	}
	return user, nil
}

func (h handlers) loadWallpapers(ctx context.Context) ([]domain.Wallpaper, error) {
	raw, err := h.settings.Setting(ctx, wallpapersKey)
	if err != nil {
		return nil, err
	}
	return domain.ParseWallpapers(raw), nil
}

func (h handlers) saveWallpapers(ctx context.Context, items []domain.Wallpaper) error {
	raw, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return h.settings.SaveSetting(ctx, wallpapersKey, string(raw))
}

// wallpaperID is `wp-${Date.now().toString(36)}-${5 random base-36 chars}`.
func wallpaperID(nowMs int64) string {
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	suffix := make([]byte, 5)
	for i := range suffix {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		suffix[i] = digits[n.Int64()]
	}
	return "wp-" + strconv.FormatInt(nowMs, 36) + "-" + string(suffix)
}

func (h handlers) uploadWallpaper(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requireAppearance(r)
	if err != nil {
		return err
	}
	var file *storage.File
	var name string
	if form, err := storage.ReadForm(r, storage.MaxRequestBytes); err == nil {
		file, name = form.File("file"), form.Value("name")
	}
	switch {
	case file == nil || file.Size() == 0:
		return httpx.BadRequest("Pilih file gambar dulu")
	case file.Size() > domain.WallpaperMaxBytes:
		return httpx.BadRequest("Gambar maksimal 8 MB")
	case storage.SniffImage(file.Data) == "":
		return httpx.BadRequest("File harus gambar JPG/PNG/WebP")
	}

	ctx := r.Context()
	items, err := h.loadWallpapers(ctx)
	if err != nil {
		return err
	}
	now := h.svc.now()
	next := domain.Wallpaper{
		ID: wallpaperID(now.UnixMilli()), Name: domain.NormalizeWallpaperName(name, file.Name),
		CreatedAt: now.UTC().Format(httpx.JSTimeLayout), CreatedBy: &user.ID,
	}
	// The limit is checked first so a rejected file is never uploaded.
	if _, msg := domain.AddWallpaper(items, next); msg != "" {
		return httpx.BadRequest(msg)
	}
	url, err := storage.FromEnv().Upload(wallpapersBucket, "", file.Data, file.Type, file.Name)
	if err != nil {
		return httpx.Status(http.StatusInternalServerError, err.Error())
	}
	next.Src = url
	if err := h.saveWallpapers(ctx, append([]domain.Wallpaper{next}, items...)); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, next)
}

func (h handlers) deleteWallpaper(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireAppearance(r); err != nil {
		return err
	}
	id := validate.JSTrim(r.URL.Query().Get("id"))
	if id == "" {
		return httpx.BadRequest("id wajib")
	}
	ctx := r.Context()
	items, err := h.loadWallpapers(ctx)
	if err != nil {
		return err
	}
	rest, removed := domain.RemoveWallpaper(items, id)
	if removed == nil {
		return httpx.NotFound("Wallpaper tidak ditemukan")
	}
	if err := h.saveWallpapers(ctx, rest); err != nil {
		return err
	}
	// The list is already clean; an orphaned file is only logged.
	if err := storage.FromEnv().Delete(wallpapersBucket, removed.Src); err != nil {
		h.svc.log.WarnContext(ctx, "[desktop/wallpapers] berkas tidak terhapus:", "src", removed.Src, "error", err)
	}
	return httpx.Data(w, http.StatusOK, map[string]string{"id": id})
}
