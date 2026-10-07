package site

import (
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"time"

	"nuhabit/backend/internal/modules/site/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// Handler serves the staff (/api/site) and public (/api/public/site) routes.
type Handler struct {
	svc  *Service
	auth *auth.Service
	log  *slog.Logger
}

const (
	staffPrefix  = "/api/site"
	publicPrefix = "/api/public/site"
)

// Routes lists every route of the module.
func (h *Handler) Routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET "+staffPrefix+"/content/{key}", h.getContent),
		r("PUT "+staffPrefix+"/content/{key}", h.putContent),
		r("GET "+staffPrefix+"/articles", h.listArticles),
		r("POST "+staffPrefix+"/articles", h.createArticle),
		r("GET "+staffPrefix+"/articles/{id}", h.getArticle),
		r("PATCH "+staffPrefix+"/articles/{id}", h.patchArticle),
		r("DELETE "+staffPrefix+"/articles/{id}", h.deleteArticle),
		r("GET "+staffPrefix+"/events", h.listEvents),
		r("POST "+staffPrefix+"/events", h.createEvent),
		r("GET "+staffPrefix+"/events/{id}", h.getEvent),
		r("PATCH "+staffPrefix+"/events/{id}", h.patchEvent),
		r("DELETE "+staffPrefix+"/events/{id}", h.deleteEvent),
		r("POST "+staffPrefix+"/uploads", h.upload),

		r("GET "+publicPrefix+"/content/{key}", h.publicContent),
		r("GET "+publicPrefix+"/branches", h.publicBranches),
		r("GET "+publicPrefix+"/branches/{slug}", h.publicBranch),
		r("GET "+publicPrefix+"/articles", h.publicArticles),
		r("GET "+publicPrefix+"/articles/{slug}", h.publicArticle),
		r("GET "+publicPrefix+"/events", h.publicEvents),
		r("GET "+publicPrefix+"/events/{slug}", h.publicEvent),
	}
}

func ok(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

func contentKey(r *http.Request) (string, error) {
	key := r.PathValue("key")
	if !domain.IsKey(key) {
		return "", httpx.NotFound("Konten tidak ditemukan")
	}
	return key, nil
}

func pathID(r *http.Request) (string, error) {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return id, nil
}

func notFound[T any](v *T, msg string) error {
	if v == nil {
		return httpx.NotFound(msg)
	}
	return nil
}

func slugTaken(err error) error {
	if errors.Is(err, ErrSlugTaken) {
		return httpx.Conflict("Slug sudah dipakai")
	}
	return err
}

/* ── content ─────────────────────────────────────────────────────────── */

func (h *Handler) getContent(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteContent...); err != nil {
		return err
	}
	key, err := contentKey(r)
	if err != nil {
		return err
	}
	value, err := h.svc.Content(r.Context(), key)
	if err != nil {
		return err
	}
	return ok(w, value)
}

func (h *Handler) putContent(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.SiteContent...)
	if err != nil {
		return err
	}
	key, err := contentKey(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	value := domain.Validate(key, f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	merged, err := h.svc.PutContent(r.Context(), key, value, user.ID)
	if err != nil {
		return err
	}
	return ok(w, merged)
}

/* ── articles ────────────────────────────────────────────────────────── */

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

var slugCheck = func(s string) (string, string, bool) {
	return "invalid_format", "Slug hanya huruf kecil, angka dan tanda hubung", slugPattern.MatchString(s)
}

var urlCheck = func(s string) (string, string, bool) { return "invalid_format", "URL tidak valid", domain.ValidURL(s) }

const (
	titleMax = 200
	bodyMax  = 100000
)

// field reports whether key was sent (null included) and its string value.
func field(f *validate.Form, key string, o validate.StrOpts) (sent bool, v *string) {
	if _, sent = f.Fields()[key]; !sent {
		return false, nil
	}
	v = f.Str(key, validate.Rule{Nullable: true}, o)
	if v != nil && *v == "" {
		v = nil
	}
	return true, v
}

// datetime reports whether key was sent and its parsed value.
func datetime(f *validate.Form, key string) (sent bool, v *time.Time) {
	sent, s := field(f, key, validate.StrOpts{Check: validate.DatetimeCheck})
	if s == nil {
		return sent, nil
	}
	if t, ok := validate.ParseJSDate(*s); ok {
		return true, &t
	}
	return true, nil
}

var (
	excerptOpts = validate.StrOpts{Trim: true, Max: 500}
	urlOpts     = validate.StrOpts{Trim: true, Max: 1000, Check: urlCheck}
	slugOpts    = validate.StrOpts{Trim: true, Max: 120, Check: slugCheck}
	titleOpts   = validate.StrOpts{Trim: true, Min: 1, Max: titleMax}
	bodyOpts    = validate.StrOpts{Max: bodyMax}
)

func parseArticleInput(f *validate.Form) ArticleInput {
	in := ArticleInput{
		Title:    f.StrDefault("title", "", titleOpts),
		Category: f.StrDefault("category", "news", validate.StrOpts{Check: validate.EnumCheck(Categories)}),
		BodyMD:   f.StrDefault("body_md", "", bodyOpts),
		Status:   f.StrDefault("status", "draft", validate.StrOpts{Check: validate.EnumCheck(Statuses)}),
	}
	_, slug := field(f, "slug", slugOpts)
	if slug != nil {
		in.Slug = *slug
	}
	_, in.Excerpt = field(f, "excerpt", excerptOpts)
	_, in.CoverImage = field(f, "cover_image_url", urlOpts)
	_, in.PublishedAt = datetime(f, "published_at")
	return in
}

func parseArticlePatch(f *validate.Form) ArticlePatch {
	var p ArticlePatch
	p.Slug = f.Str("slug", validate.Rule{Optional: true}, slugOpts)
	p.Title = f.Str("title", validate.Rule{Optional: true}, titleOpts)
	p.Category = f.Enum("category", validate.Rule{Optional: true}, Categories)
	p.BodyMD = f.Str("body_md", validate.Rule{Optional: true}, bodyOpts)
	p.Status = f.Enum("status", validate.Rule{Optional: true}, Statuses)
	if sent, v := field(f, "excerpt", excerptOpts); sent {
		p.Excerpt = &v
	}
	if sent, v := field(f, "cover_image_url", urlOpts); sent {
		p.CoverImage = &v
	}
	if sent, v := datetime(f, "published_at"); sent {
		p.PublishedAt = &v
	}
	return p
}

func (h *Handler) listArticles(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteArticles...); err != nil {
		return err
	}
	list, err := h.svc.ListArticles(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) createArticle(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.SiteArticles...)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	in := parseArticleInput(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	a, err := h.svc.CreateArticle(r.Context(), in, user.ID)
	if err != nil {
		return slugTaken(err)
	}
	return httpx.Data(w, http.StatusCreated, a)
}

func (h *Handler) getArticle(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteArticles...); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	a, err := h.svc.Article(r.Context(), id)
	if err != nil {
		return err
	}
	if err := notFound(a, "Artikel tidak ditemukan"); err != nil {
		return err
	}
	return ok(w, a)
}

func (h *Handler) patchArticle(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteArticles...); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	patch := parseArticlePatch(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	a, err := h.svc.UpdateArticle(r.Context(), id, patch)
	if err != nil {
		return slugTaken(err)
	}
	if err := notFound(a, "Artikel tidak ditemukan"); err != nil {
		return err
	}
	return ok(w, a)
}

func (h *Handler) deleteArticle(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteArticles...); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	deleted, err := h.svc.DeleteArticle(r.Context(), id)
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.NotFound("Artikel tidak ditemukan")
	}
	return ok(w, map[string]string{"id": id})
}

/* ── events ──────────────────────────────────────────────────────────── */

func parseEventInput(f *validate.Form) EventInput {
	in := EventInput{
		Title:  f.StrDefault("title", "", titleOpts),
		BodyMD: f.StrDefault("body_md", "", bodyOpts),
		Status: f.StrDefault("status", "draft", validate.StrOpts{Check: validate.EnumCheck(Statuses)}),
	}
	if s := f.Str("starts_at", validate.Rule{}, validate.StrOpts{Check: validate.DatetimeCheck}); s != nil {
		in.StartsAt, _ = validate.ParseJSDate(*s)
	}
	_, slug := field(f, "slug", slugOpts)
	if slug != nil {
		in.Slug = *slug
	}
	_, in.EndsAt = datetime(f, "ends_at")
	_, in.Location = field(f, "location_text", excerptOpts)
	_, in.CoverImage = field(f, "cover_image_url", urlOpts)
	_, in.FormSlug = field(f, "form_slug", slugOpts)
	return in
}

func parseEventPatch(f *validate.Form) EventPatch {
	var p EventPatch
	p.Slug = f.Str("slug", validate.Rule{Optional: true}, slugOpts)
	p.Title = f.Str("title", validate.Rule{Optional: true}, titleOpts)
	if s := f.Str("starts_at", validate.Rule{Optional: true}, validate.StrOpts{Check: validate.DatetimeCheck}); s != nil {
		if t, ok := validate.ParseJSDate(*s); ok {
			p.StartsAt = &t
		}
	}
	p.BodyMD = f.Str("body_md", validate.Rule{Optional: true}, bodyOpts)
	p.Status = f.Enum("status", validate.Rule{Optional: true}, Statuses)
	if sent, v := datetime(f, "ends_at"); sent {
		p.EndsAt = &v
	}
	if sent, v := field(f, "location_text", excerptOpts); sent {
		p.Location = &v
	}
	if sent, v := field(f, "cover_image_url", urlOpts); sent {
		p.CoverImage = &v
	}
	if sent, v := field(f, "form_slug", slugOpts); sent {
		p.FormSlug = &v
	}
	return p
}

func (h *Handler) listEvents(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteEvents...); err != nil {
		return err
	}
	list, err := h.svc.ListEvents(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) createEvent(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.SiteEvents...)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	in := parseEventInput(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	e, err := h.svc.CreateEvent(r.Context(), in, user.ID)
	if err != nil {
		return slugTaken(err)
	}
	return httpx.Data(w, http.StatusCreated, e)
}

func (h *Handler) getEvent(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteEvents...); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	e, err := h.svc.Event(r.Context(), id)
	if err != nil {
		return err
	}
	if err := notFound(e, "Event tidak ditemukan"); err != nil {
		return err
	}
	return ok(w, e)
}

func (h *Handler) patchEvent(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteEvents...); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	patch := parseEventPatch(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	e, err := h.svc.UpdateEvent(r.Context(), id, patch)
	if err != nil {
		return slugTaken(err)
	}
	if err := notFound(e, "Event tidak ditemukan"); err != nil {
		return err
	}
	return ok(w, e)
}

func (h *Handler) deleteEvent(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SiteEvents...); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	deleted, err := h.svc.DeleteEvent(r.Context(), id)
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.NotFound("Event tidak ditemukan")
	}
	return ok(w, map[string]string{"id": id})
}

/* ── uploads ─────────────────────────────────────────────────────────── */

const maxImageBytes = 5 << 20

var imageTypes = []string{"image/jpeg", "image/png", "image/webp"}

// upload stores a cover or hero image in the public "site" bucket.
func (h *Handler) upload(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Site...); err != nil {
		return err
	}
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return httpx.BadRequest("Format unggahan tidak valid")
	}
	file := form.File("file")
	switch {
	case file == nil || file.Size() == 0:
		return httpx.BadRequest("File tidak ditemukan")
	case file.Size() > maxImageBytes:
		return httpx.BadRequest("Ukuran gambar maksimal 5 MB")
	case !slices.Contains(imageTypes, file.Type):
		return httpx.BadRequest("Format harus JPG, PNG, atau WEBP")
	}
	url, err := storage.FromEnv().Upload("site", "", file.Data, file.Type, file.Name)
	if err != nil {
		h.log.ErrorContext(r.Context(), "[site] upload failed", "error", err)
		return httpx.Status(http.StatusInternalServerError, "Gagal mengunggah gambar")
	}
	return httpx.Data(w, http.StatusCreated, map[string]string{"url": url})
}

/* ── public ──────────────────────────────────────────────────────────── */

func (h *Handler) publicContent(w http.ResponseWriter, r *http.Request) error {
	key, err := contentKey(r)
	if err != nil {
		return err
	}
	value, err := h.svc.Content(r.Context(), key)
	if err != nil {
		return err
	}
	return ok(w, value)
}

func (h *Handler) publicBranches(w http.ResponseWriter, r *http.Request) error {
	list, err := h.svc.PublicBranches(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) publicBranch(w http.ResponseWriter, r *http.Request) error {
	b, err := h.svc.PublicBranch(r.Context(), r.PathValue("slug"))
	if err != nil {
		return err
	}
	if err := notFound(b, "Branch not found"); err != nil {
		return err
	}
	return ok(w, b)
}

func (h *Handler) publicArticles(w http.ResponseWriter, r *http.Request) error {
	category := r.URL.Query().Get("category")
	if category != "" && !slices.Contains(Categories, category) {
		return httpx.BadRequest("Invalid category")
	}
	list, err := h.svc.PublishedArticles(r.Context(), category)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) publicArticle(w http.ResponseWriter, r *http.Request) error {
	a, err := h.svc.PublishedArticle(r.Context(), r.PathValue("slug"))
	if err != nil {
		return err
	}
	if err := notFound(a, "Article not found"); err != nil {
		return err
	}
	return ok(w, a)
}

func (h *Handler) publicEvents(w http.ResponseWriter, r *http.Request) error {
	list, err := h.svc.PublishedEvents(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *Handler) publicEvent(w http.ResponseWriter, r *http.Request) error {
	e, err := h.svc.PublishedEvent(r.Context(), r.PathValue("slug"))
	if err != nil {
		return err
	}
	if err := notFound(e, "Event not found"); err != nil {
		return err
	}
	return ok(w, e)
}
