package site

import "context"

// Branch is a branch's public profile as the site shows it. The
// configuration context owns the rows; internal/app adapts its reader.
type Branch struct {
	Slug         string        `json:"slug"`
	Name         string        `json:"name"`
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

// Benefit is one "why train here" line.
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

// Extra is an add-on service.
type Extra struct {
	Name  string `json:"name"`
	Blurb string `json:"blurb"`
}

// Testimonial is a member quote.
type Testimonial struct {
	Name  string `json:"name"`
	Quote string `json:"quote"`
	Role  string `json:"role"`
}

// BranchSummary is the list card of a public branch.
type BranchSummary struct {
	Slug         string   `json:"slug"`
	Name         string   `json:"name"`
	Address      *string  `json:"address"`
	City         *string  `json:"city"`
	Postcode     *string  `json:"postcode"`
	Lat          *float64 `json:"lat"`
	Lng          *float64 `json:"lng"`
	Phone        *string  `json:"phone"`
	Instagram    *string  `json:"instagram"`
	HeroImageURL *string  `json:"hero_image_url"`
}

// Summary is the list view of a branch.
func (b Branch) Summary() BranchSummary {
	return BranchSummary{Slug: b.Slug, Name: b.Name, Address: b.Address, City: b.City, Postcode: b.Postcode,
		Lat: b.Lat, Lng: b.Lng, Phone: b.Phone, Instagram: b.Instagram, HeroImageURL: b.HeroImageURL}
}

// Branches reads public branch profiles from the configuration context.
type Branches interface {
	// Public lists the active public branches by name.
	Public(ctx context.Context) ([]Branch, error)
	// BySlug reads one active public branch, nil when none.
	BySlug(ctx context.Context, slug string) (*Branch, error)
}

// Ports are the adapters internal/app wires.
type Ports struct {
	Branches Branches
}
