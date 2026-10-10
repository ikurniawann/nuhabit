package shop

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Member wishlists: the product ids a signed-in member saved (guests keep
// theirs in the browser and merge on sign-in).

// WishlistLimit caps the saved product ids.
const WishlistLimit = 200

// WishlistView is GET and PUT /api/public/shop/{slug}/wishlist.
type WishlistView struct {
	ProductIDs []string `json:"productIds"`
}

// Wishlist reads the member's saved product ids (empty without a row).
func (s *Service) Wishlist(ctx context.Context, customerID string) (*WishlistView, error) {
	v := &WishlistView{ProductIDs: []string{}}
	err := s.db.QueryRow(ctx, `SELECT product_ids FROM shop.wishlists WHERE customer_id = $1::uuid`, customerID).Scan(&v.ProductIDs)
	if database.IsNoRows(err) {
		return v, nil
	}
	return v, err
}

// SaveWishlist replaces the member's saved product ids, deduplicated in
// order, keeping the first WishlistLimit.
func (s *Service) SaveWishlist(ctx context.Context, customerID string, productIDs []string) (*WishlistView, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, id := range productIDs {
		if seen[id] || len(ids) == WishlistLimit {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	_, err := s.db.Exec(ctx, `INSERT INTO shop.wishlists (customer_id, product_ids) VALUES ($1::uuid, $2)
		ON CONFLICT (customer_id) DO UPDATE SET product_ids = EXCLUDED.product_ids, updated_at = now()`, customerID, ids)
	if err != nil {
		return nil, err
	}
	return &WishlistView{ProductIDs: ids}, nil
}
