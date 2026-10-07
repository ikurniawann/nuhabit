package settings

import (
	"errors"
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/configuration/branches"
	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Branch public profile: GET and PUT /api/settings/business/branch/{id}/profile.
// The public site reads the same columns through the site module's port.

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

const (
	shortText = 200
	longText  = 4000
	maxLines  = 30
)

func (h *handler) branchProfile(r *http.Request) (string, error) {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsBusiness...); err != nil {
		return "", err
	}
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return "", httpx.BadRequest("ID cabang tidak valid")
	}
	return id, nil
}

func (h *handler) getBranchProfile(w http.ResponseWriter, r *http.Request) error {
	id, err := h.branchProfile(r)
	if err != nil {
		return err
	}
	p, err := (branches.Service{}).Profile(r.Context(), h.db, id)
	if err != nil {
		return err
	}
	if p == nil {
		return httpx.NotFound("Cabang tidak ditemukan")
	}
	return httpx.Data(w, http.StatusOK, p)
}

func (h *handler) putBranchProfile(w http.ResponseWriter, r *http.Request) error {
	id, err := h.branchProfile(r)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseProfileEdit(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	p, err := (branches.Service{}).SaveProfile(r.Context(), h.db, id, in)
	switch {
	case errors.Is(err, branches.ErrSlugTaken):
		return httpx.Conflict("Slug sudah dipakai cabang lain")
	case err != nil:
		return err
	case p == nil:
		return httpx.NotFound("Cabang tidak ditemukan")
	}
	return httpx.Data(w, http.StatusOK, p)
}

// optional is a nullable, optional, trimmed string field.
func optional(f *validate.Form, key string, max int) *string {
	s := f.Str(key, validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: max})
	if s == nil || *s == "" {
		return nil
	}
	return s
}

func lines(f *validate.Form, key string) []string {
	out := f.Strings(key, validate.Rule{Optional: true, Nullable: true}, maxLines, validate.StrOpts{Trim: true, Max: shortText})
	if out == nil {
		return []string{}
	}
	return out
}

func parseProfileEdit(f *validate.Form) branches.ProfileEdit {
	in := branches.ProfileEdit{
		Slug: f.StrDefault("slug", "", validate.StrOpts{Trim: true, Min: 1, Max: 80, Check: func(s string) (string, string, bool) {
			return "invalid_format", "Slug hanya huruf kecil, angka dan tanda hubung", slugPattern.MatchString(s)
		}}),
		IsPublic:     f.BoolDefault("is_public", false),
		Address:      optional(f, "address", longText),
		City:         optional(f, "city", shortText),
		Postcode:     optional(f, "postcode", 20),
		Lat:          f.Num("lat", validate.Rule{Optional: true, Nullable: true}, validate.NumOpts{Min: validate.Bound(-90), Max: validate.Bound(90)}),
		Lng:          f.Num("lng", validate.Rule{Optional: true, Nullable: true}, validate.NumOpts{Min: validate.Bound(-180), Max: validate.Bound(180)}),
		Phone:        optional(f, "phone", 40),
		Email:        optional(f, "email", shortText),
		Instagram:    optional(f, "instagram", shortText),
		Directions:   optional(f, "directions", longText),
		HeroImageURL: optional(f, "hero_image_url", 1000),
	}
	in.Benefits = []branches.Benefit{}
	f.List("benefits", validate.Rule{Optional: true, Nullable: true}, maxLines, func(items *validate.Form, i int, v any) {
		it := items.Item(i, v)
		in.Benefits = append(in.Benefits, branches.Benefit{
			Title: it.StrDefault("title", "", validate.StrOpts{Trim: true, Max: shortText}),
			Text:  it.StrDefault("text", "", validate.StrOpts{Trim: true, Max: longText}),
		})
	})
	if raw, sent := f.Fields()["accordions"]; sent && raw != nil {
		acc := f.Child("accordions")
		in.Accordions = branches.Accordions{
			Facilities: lines(acc, "facilities"), Parking: lines(acc, "parking"),
			Team: lines(acc, "team"), Community: lines(acc, "community"),
		}
	}
	in.Extras = []branches.Extra{}
	f.List("extras", validate.Rule{Optional: true, Nullable: true}, maxLines, func(items *validate.Form, i int, v any) {
		it := items.Item(i, v)
		in.Extras = append(in.Extras, branches.Extra{
			Name:  it.StrDefault("name", "", validate.StrOpts{Trim: true, Max: shortText}),
			Blurb: it.StrDefault("blurb", "", validate.StrOpts{Trim: true, Max: longText}),
		})
	})
	in.Testimonials = []branches.Testimonial{}
	f.List("testimonials", validate.Rule{Optional: true, Nullable: true}, maxLines, func(items *validate.Form, i int, v any) {
		it := items.Item(i, v)
		in.Testimonials = append(in.Testimonials, branches.Testimonial{
			Name:  it.StrDefault("name", "", validate.StrOpts{Trim: true, Max: shortText}),
			Quote: it.StrDefault("quote", "", validate.StrOpts{Trim: true, Max: longText}),
			Role:  it.StrDefault("role", "", validate.StrOpts{Trim: true, Max: shortText}),
		})
	})
	return in
}
