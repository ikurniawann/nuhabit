package branches

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Benefit is one "why train here" line on a branch page.
type Benefit struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

// Accordions are the collapsible lists on a branch page.
type Accordions struct {
	Facilities []string `json:"facilities"`
	Parking    []string `json:"parking"`
	Team       []string `json:"team"`
	Community  []string `json:"community"`
}

// Extra is an add-on service offered at the branch.
type Extra struct {
	Name  string `json:"name"`
	Blurb string `json:"blurb"`
}

// Testimonial is a member quote shown on the branch page.
type Testimonial struct {
	Name  string `json:"name"`
	Quote string `json:"quote"`
	Role  string `json:"role"`
}

// Profile is the public face of a configuration.branches row.
type Profile struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Slug         string        `json:"slug"`
	IsPublic     bool          `json:"is_public"`
	Address      *string       `json:"address"`
	City         *string       `json:"city"`
	Postcode     *string       `json:"postcode"`
	Lat          *float64      `json:"lat"`
	Lng          *float64      `json:"lng"`
	Phone        *string       `json:"phone"`
	Email        *string       `json:"email"`
	Instagram    *string       `json:"instagram"`
	Directions   *string       `json:"directions"`
	HeroImageURL *string       `json:"hero_image_url"`
	Benefits     []Benefit     `json:"benefits"`
	Accordions   Accordions    `json:"accordions"`
	Extras       []Extra       `json:"extras"`
	Testimonials []Testimonial `json:"testimonials"`
}

// ProfileEdit is what staff may change on a profile.
type ProfileEdit struct {
	Slug         string
	IsPublic     bool
	Address      *string
	City         *string
	Postcode     *string
	Lat          *float64
	Lng          *float64
	Phone        *string
	Email        *string
	Instagram    *string
	Directions   *string
	HeroImageURL *string
	Benefits     []Benefit
	Accordions   Accordions
	Extras       []Extra
	Testimonials []Testimonial
}

// ErrSlugTaken is a slug another branch already uses.
var ErrSlugTaken = errors.New("slug sudah dipakai cabang lain")

const profileColumns = `id::text, name, coalesce(slug, ''), is_public, address, city, postcode,
	lat::text, lng::text, phone, email, instagram, directions, hero_image_url,
	benefits, accordions, extras, testimonials`

func scanProfile(row pgx.Row) (*Profile, error) {
	var p Profile
	var lat, lng *string
	var benefits, accordions, extras, testimonials []byte
	err := row.Scan(&p.ID, &p.Name, &p.Slug, &p.IsPublic, &p.Address, &p.City, &p.Postcode,
		&lat, &lng, &p.Phone, &p.Email, &p.Instagram, &p.Directions, &p.HeroImageURL,
		&benefits, &accordions, &extras, &testimonials)
	if err != nil {
		return nil, err
	}
	p.Lat, p.Lng = parseCoord(lat), parseCoord(lng)
	// Stored JSON is validated on write; a malformed value renders empty.
	_ = json.Unmarshal(benefits, &p.Benefits)
	_ = json.Unmarshal(accordions, &p.Accordions)
	_ = json.Unmarshal(extras, &p.Extras)
	_ = json.Unmarshal(testimonials, &p.Testimonials)
	p.normalize()
	return &p, nil
}

func parseCoord(s *string) *float64 {
	if s == nil {
		return nil
	}
	v, err := strconv.ParseFloat(*s, 64)
	if err != nil {
		return nil
	}
	return &v
}

// normalize replaces nil lists with empty ones so JSON renders [] not null.
func (p *Profile) normalize() {
	if p.Benefits == nil {
		p.Benefits = []Benefit{}
	}
	if p.Extras == nil {
		p.Extras = []Extra{}
	}
	if p.Testimonials == nil {
		p.Testimonials = []Testimonial{}
	}
	p.Accordions.normalize()
}

func (a *Accordions) normalize() {
	for _, l := range []*[]string{&a.Facilities, &a.Parking, &a.Team, &a.Community} {
		if *l == nil {
			*l = []string{}
		}
	}
}

// Profile reads one branch's profile by id, nil when the branch does not exist.
func (Service) Profile(ctx context.Context, q database.Querier, id string) (*Profile, error) {
	p, err := scanProfile(q.QueryRow(ctx, `SELECT `+profileColumns+` FROM configuration.branches WHERE id = $1`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return p, err
}

// PublicProfiles lists active public branches by name.
func (Service) PublicProfiles(ctx context.Context, q database.Querier) ([]Profile, error) {
	rows, err := q.Query(ctx, `SELECT `+profileColumns+` FROM configuration.branches
		WHERE is_public AND is_active AND slug IS NOT NULL ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// PublicProfile reads one active public branch by slug, nil when none.
func (Service) PublicProfile(ctx context.Context, q database.Querier, slug string) (*Profile, error) {
	p, err := scanProfile(q.QueryRow(ctx, `SELECT `+profileColumns+` FROM configuration.branches
		WHERE slug = $1 AND is_public AND is_active`, slug))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return p, err
}

// SaveProfile writes the public profile of branch id and returns it; nil
// when the branch does not exist.
func (s Service) SaveProfile(ctx context.Context, q database.Querier, id string, in ProfileEdit) (*Profile, error) {
	in.Accordions.normalize()
	benefits, _ := json.Marshal(orEmpty(in.Benefits))
	accordions, _ := json.Marshal(in.Accordions)
	extras, _ := json.Marshal(orEmpty(in.Extras))
	testimonials, _ := json.Marshal(orEmpty(in.Testimonials))
	tag, err := q.Exec(ctx, `UPDATE configuration.branches SET
		slug = $2, is_public = $3, address = $4, city = $5, postcode = $6, lat = $7, lng = $8,
		phone = $9, email = $10, instagram = $11, directions = $12, hero_image_url = $13,
		benefits = $14, accordions = $15, extras = $16, testimonials = $17, updated_at = now()
		WHERE id = $1`,
		id, in.Slug, in.IsPublic, in.Address, in.City, in.Postcode, in.Lat, in.Lng,
		in.Phone, in.Email, in.Instagram, in.Directions, in.HeroImageURL,
		benefits, accordions, extras, testimonials)
	switch {
	case database.IsUniqueViolation(err):
		return nil, ErrSlugTaken
	case err != nil:
		return nil, err
	case tag.RowsAffected() == 0:
		return nil, nil
	}
	return s.Profile(ctx, q, id)
}

func orEmpty[T any](list []T) []T {
	if list == nil {
		return []T{}
	}
	return list
}
