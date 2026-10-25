package site

import (
	"context"
	"net/http"
	"slices"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Member news: the articles the member app shows (audience members or
// both), edited on Gym → News Member and read by members of the branches
// they target. They live in site.articles next to the public site's.

// NewsCategories are the member app filters.
var NewsCategories = []string{"news", "event", "tips", "promo"}

// siteCategory files a member category under the public site's categories
// for an article that shows on both.
var siteCategory = map[string]string{"news": "news", "event": "events", "tips": "training", "promo": "news"}

// BranchOption is a branch a news article may target.
type BranchOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// NewsAudience tells which members see which news.
type NewsAudience interface {
	// Branches lists the active branches, by name.
	Branches(ctx context.Context) ([]BranchOption, error)
	// MemberBranches lists the branches a member trains at.
	MemberBranches(ctx context.Context, customerID string) ([]string, error)
}

// NewsItem is an article as the member app lists it; Body only on detail.
type NewsItem struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Category    string        `json:"category"`
	Summary     *string       `json:"summary"`
	Body        *string       `json:"body,omitempty"`
	ImageURL    *string       `json:"image_url"`
	Pinned      bool          `json:"pinned"`
	PublishedAt *httpx.JSTime `json:"published_at"`
}

func newsItem(a Article, withBody bool) NewsItem {
	item := NewsItem{ID: a.ID, Title: a.Title, Summary: a.Excerpt, ImageURL: a.CoverImage, Pinned: a.Pinned, PublishedAt: a.PublishedAt}
	if a.MemberCategory != nil {
		item.Category = *a.MemberCategory
	}
	if withBody {
		item.Body = &a.BodyMD
	}
	return item
}

// memberNewsLimit caps the member feed.
const memberNewsLimit = 50

// MemberNews lists the published news a member sees, pinned first, of one
// category when set.
func (s *Service) MemberNews(ctx context.Context, customerID, category string) ([]NewsItem, error) {
	branches, err := s.audience.MemberBranches(ctx, customerID)
	if err != nil {
		return nil, err
	}
	if branches == nil {
		branches = []string{}
	}
	list, err := s.repo.Articles(ctx, ArticleFilter{Audience: AudienceMembers, PublishedOnly: true, Now: s.now(),
		MemberCategory: category, MemberBranches: branches, Limit: memberNewsLimit})
	out := make([]NewsItem, len(list))
	for i, a := range list {
		out[i] = newsItem(a, false)
	}
	return out, err
}

// MemberNewsItem reads one article the member sees, nil when none.
func (s *Service) MemberNewsItem(ctx context.Context, customerID, id string) (*NewsItem, error) {
	branches, err := s.audience.MemberBranches(ctx, customerID)
	if err != nil {
		return nil, err
	}
	if branches == nil {
		branches = []string{}
	}
	a, err := s.repo.MemberArticle(ctx, id, branches, s.now())
	if err != nil || a == nil {
		return nil, err
	}
	item := newsItem(*a, true)
	return &item, nil
}

// StaffNews is the editor's list (every status) and the branches to target.
type StaffNews struct {
	News     []Article      `json:"news"`
	Branches []BranchOption `json:"branches"`
}

func (s *Service) StaffNews(ctx context.Context) (StaffNews, error) {
	news, err := s.repo.Articles(ctx, ArticleFilter{Audience: AudienceMembers})
	if err != nil {
		return StaffNews{}, err
	}
	branches, err := s.audience.Branches(ctx)
	return StaffNews{News: news, Branches: branches}, err
}

// memberArticle reads an article of the member feed for staff, nil when
// it does not exist or shows on the public site only.
func (s *Service) memberArticle(ctx context.Context, id string) (*Article, error) {
	a, err := s.repo.ArticleByID(ctx, id)
	if err != nil || a == nil || a.Audience == AudienceSite {
		return nil, err
	}
	return a, nil
}

/* ── HTTP ────────────────────────────────────────────────────────────── */

func (h *Handler) newsRoutes() []module.Route {
	news := iam.GymNews
	staff := func(pattern, action string, fn auth.StaffFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: auth.Staff(h.auth, fn, iam.Can(action, news))}
	}
	return []module.Route{
		staff("GET /api/gym/news", "read", h.listNews),
		staff("POST /api/gym/news", "create", h.createNews),
		staff("PATCH /api/gym/news/{id}", "update", h.patchNews),
		staff("DELETE /api/gym/news/{id}", "delete", h.deleteNews),
		staff("POST /api/gym/news/uploads", "create", func(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
			return h.storeImage(w, r)
		}),
		{Pattern: "GET /api/member-portal/app/news", Handler: h.auth.MemberHandler("Gagal memuat news", h.memberNews)},
		{Pattern: "GET /api/member-portal/app/news/{id}", Handler: h.auth.MemberHandler("Gagal memuat news", h.memberNewsItem)},
	}
}

// newsFields reads the member fields of a news body; partial leaves out
// what is not sent.
type newsFields struct {
	category   *string
	pinned     *bool
	alsoOnSite *bool
	branchIDs  *[]string
}

func parseNewsFields(f *validate.Form, partial bool) newsFields {
	var n newsFields
	n.category = f.Enum("member_category", validate.Rule{Optional: partial}, NewsCategories)
	n.pinned = f.Bool("pinned", validate.Rule{Optional: true})
	n.alsoOnSite = f.Bool("also_on_site", validate.Rule{Optional: true})
	if _, sent := f.Fields()["branch_ids"]; sent {
		ids := f.Strings("branch_ids", validate.Rule{}, 50, validate.StrOpts{Check: validate.UUIDCheck})
		if ids == nil {
			ids = []string{}
		}
		n.branchIDs = &ids
	}
	return n
}

func audienceOf(alsoOnSite *bool) string {
	if alsoOnSite != nil && *alsoOnSite {
		return AudienceBoth
	}
	return AudienceMembers
}

func (h *Handler) listNews(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.StaffNews(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *Handler) createNews(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	f := validate.New(validate.ReadBody(r))
	in := parseArticleInput(f)
	n := parseNewsFields(f, false)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	in.MemberCategory = n.category
	in.Category = siteCategory[*n.category]
	in.Audience = audienceOf(n.alsoOnSite)
	in.Pinned = n.pinned != nil && *n.pinned
	if n.branchIDs != nil {
		in.BranchIDs = *n.branchIDs
	}
	a, err := h.svc.CreateArticle(r.Context(), in, u.ID)
	if err != nil {
		return slugTaken(err)
	}
	return httpx.Data(w, http.StatusCreated, a)
}

func (h *Handler) patchNews(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	p := parseArticlePatch(f)
	n := parseNewsFields(f, true)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	current, err := h.svc.memberArticle(r.Context(), id)
	if err != nil {
		return err
	}
	if current == nil {
		return httpx.NotFound("News tidak ditemukan")
	}
	p.Category = nil
	if n.category != nil {
		c := siteCategory[*n.category]
		p.MemberCategory, p.Category = n.category, &c
	}
	if n.alsoOnSite != nil {
		audience := audienceOf(n.alsoOnSite)
		p.Audience = &audience
	}
	p.Pinned, p.BranchIDs = n.pinned, n.branchIDs
	a, err := h.svc.UpdateArticle(r.Context(), id, p)
	if err != nil {
		return slugTaken(err)
	}
	return ok(w, a)
}

func (h *Handler) deleteNews(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	current, err := h.svc.memberArticle(r.Context(), id)
	if err != nil {
		return err
	}
	if current == nil {
		return httpx.NotFound("News tidak ditemukan")
	}
	if _, err := h.svc.DeleteArticle(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

func (h *Handler) memberNews(w http.ResponseWriter, r *http.Request, customerID string) error {
	category := r.URL.Query().Get("category")
	if category != "" && !slices.Contains(NewsCategories, category) {
		return httpx.BadRequest("Kategori tidak valid")
	}
	out, err := h.svc.MemberNews(r.Context(), customerID, category)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *Handler) memberNewsItem(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	item, err := h.svc.MemberNewsItem(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	if item == nil {
		return httpx.NotFound("News tidak ditemukan")
	}
	return ok(w, item)
}
