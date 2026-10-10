package shop

import (
	"net/http"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Routes of the signed-in buyer (reviews, wishlist) and the staff review
// moderation list.

// requireMember resolves the member session of a public request; msg is
// the 401 text for a guest.
func (h *handler) requireMember(r *http.Request, msg string) (*Member, error) {
	member, err := h.svc.ports.Members.FromRequest(r)
	if err != nil {
		return nil, err
	}
	if member == nil {
		return nil, httpx.Unauthorized(msg)
	}
	return member, nil
}

// createReview is POST /api/public/shop/{slug}/reviews.
func (h *handler) createReview(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-review", 10); err != nil {
		return err
	}
	if _, err := h.storefront(r); err != nil {
		return err
	}
	member, err := h.requireMember(r, "Sign in to write a review")
	if err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	var in ReviewInput
	if token := f.UUID("orderToken", validate.Rule{}); token != nil {
		in.OrderToken = *token
	}
	if id := f.UUID("productId", validate.Rule{}); id != nil {
		in.ProductID = *id
	}
	if rating := f.Int("rating", validate.Rule{}, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(5)}); rating != nil {
		in.Rating = *rating
	}
	in.Comment = f.Str("comment", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 1000})
	if !f.Valid() {
		return httpx.BadRequest("Invalid review")
	}
	view, err := h.svc.CreateReview(r.Context(), *member, in)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// productReviews is GET /api/public/shop/{slug}/products/{id}/reviews.
func (h *handler) productReviews(w http.ResponseWriter, r *http.Request) error {
	if err := h.limit(r, "shop-reviews", 60); err != nil {
		return err
	}
	if _, err := h.storefront(r); err != nil {
		return err
	}
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return errUnknownProduct
	}
	reviews, err := h.svc.PublishedReviews(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, reviews)
}

// wishlistMember is the signed-in member behind a wishlist request on
// a known storefront.
func (h *handler) wishlistMember(r *http.Request) (*Member, error) {
	if err := h.limit(r, "shop-wishlist", 60); err != nil {
		return nil, err
	}
	if _, err := h.storefront(r); err != nil {
		return nil, err
	}
	return h.requireMember(r, "Sign in to save your wishlist")
}

// getWishlist is GET /api/public/shop/{slug}/wishlist.
func (h *handler) getWishlist(w http.ResponseWriter, r *http.Request) error {
	member, err := h.wishlistMember(r)
	if err != nil {
		return err
	}
	view, err := h.svc.Wishlist(r.Context(), member.ID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// putWishlist is PUT /api/public/shop/{slug}/wishlist {productIds}.
func (h *handler) putWishlist(w http.ResponseWriter, r *http.Request) error {
	member, err := h.wishlistMember(r)
	if err != nil {
		return err
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	ids := []string{}
	f.List("productIds", validate.Rule{}, WishlistLimit, func(items *validate.Form, i int, v any) {
		if id, ok := items.CheckString(i, v, validate.StrOpts{Check: validate.UUIDCheck}); ok {
			ids = append(ids, id)
		}
	})
	if !f.Valid() {
		return httpx.BadRequest("Invalid wishlist")
	}
	view, err := h.svc.SaveWishlist(r.Context(), member.ID, ids)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// listReviews is GET /api/shop/reviews?status=.
func (h *handler) listReviews(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListReviews(r.Context(), r.URL.Query().Get("status"))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// moderateReview is PATCH /api/shop/reviews/{id} {status}.
func (h *handler) moderateReview(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return errReviewNotFound
	}
	raw, err := readJSON(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	status := f.Enum("status", validate.Rule{}, ReviewStatuses)
	if !f.Valid() {
		return httpx.BadRequest("Invalid status")
	}
	view, err := h.svc.ModerateReview(r.Context(), id, *status)
	if err != nil {
		return err
	}
	return ok(w, view)
}
