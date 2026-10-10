package shop

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Product reviews: a member with a paid order containing the product
// writes one from the order page; staff publish or reject it; the
// storefront shows published ones with the product's average rating.

// paidOrderCond is a shop.orders row (aliased o) the buyer has paid for.
const paidOrderCond = `o.paid_at IS NOT NULL AND o.status NOT IN ('pending', 'cancelled', 'refund')`

var (
	errReviewNotEligible = httpx.Forbidden("You can review products from your paid orders only")
	errReviewExists      = httpx.Conflict("You have already reviewed this product")
	errReviewNotFound    = httpx.NotFound("Review not found")
)

// ReviewInput is POST /api/public/shop/{slug}/reviews.
type ReviewInput struct {
	OrderToken string
	ProductID  string
	Rating     int
	Comment    *string
}

// ReviewView is the member's own review as created.
type ReviewView struct {
	ID        string       `json:"id"`
	ProductID string       `json:"productId"`
	Rating    int          `json:"rating"`
	Comment   *string      `json:"comment"`
	Status    string       `json:"status"`
	CreatedAt httpx.JSTime `json:"createdAt"`
}

// CreateReview writes a pending review once the SQL eligibility check
// passes: the token's order belongs to the member, is paid and contains
// the product. A second review of the product is a 409.
func (s *Service) CreateReview(ctx context.Context, member Member, in ReviewInput) (*ReviewView, error) {
	var orderID string
	err := s.db.QueryRow(ctx, `SELECT o.id::text FROM shop.orders o
		WHERE o.access_token = $1::uuid AND o.customer_id = $2::uuid AND `+paidOrderCond+`
		  AND EXISTS (SELECT 1 FROM shop.order_items i WHERE i.order_id = o.id AND i.product_id = $3::uuid)`,
		in.OrderToken, member.ID, in.ProductID).Scan(&orderID)
	if database.IsNoRows(err) {
		return nil, errReviewNotEligible
	}
	if err != nil {
		return nil, err
	}
	v := ReviewView{ProductID: in.ProductID, Rating: in.Rating, Comment: orNil(in.Comment), Status: "pending"}
	var createdAt time.Time
	err = s.db.QueryRow(ctx, `INSERT INTO shop.product_reviews (product_id, customer_id, order_id, rating, comment)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
		ON CONFLICT (customer_id, product_id) DO NOTHING
		RETURNING id::text, created_at`, in.ProductID, member.ID, orderID, in.Rating, v.Comment).Scan(&v.ID, &createdAt)
	if database.IsNoRows(err) {
		return nil, errReviewExists
	}
	v.CreatedAt = httpx.JSTime(createdAt)
	return &v, err
}

// PublicReview is a published review on the product sheet.
type PublicReview struct {
	ID        string       `json:"id"`
	Author    string       `json:"author"`
	Rating    int          `json:"rating"`
	Comment   *string      `json:"comment"`
	CreatedAt httpx.JSTime `json:"createdAt"`
}

// publicReviewLimit is how many reviews the product sheet lists.
const publicReviewLimit = 20

// PublishedReviews lists the product's published reviews, newest first.
func (s *Service) PublishedReviews(ctx context.Context, productID string) ([]PublicReview, error) {
	rows, err := s.db.Query(ctx, `SELECT r.id::text, o.customer_name, r.rating, r.comment, r.created_at
		FROM shop.product_reviews r JOIN shop.orders o ON o.id = r.order_id
		WHERE r.product_id = $1::uuid AND r.status = 'published'
		ORDER BY r.created_at DESC LIMIT $2`, productID, publicReviewLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicReview{}
	for rows.Next() {
		var r PublicReview
		var createdAt time.Time
		if err := rows.Scan(&r.ID, &r.Author, &r.Rating, &r.Comment, &createdAt); err != nil {
			return nil, err
		}
		r.Author, r.CreatedAt = domain.ReviewerName(r.Author), httpx.JSTime(createdAt)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReviewRow is a review in the moderation list.
type ReviewRow struct {
	ID           string       `json:"id"`
	ProductID    string       `json:"product_id"`
	ProductName  string       `json:"product_name"`
	CustomerName string       `json:"customer_name"`
	OrderNumber  string       `json:"order_number"`
	Rating       int          `json:"rating"`
	Comment      *string      `json:"comment"`
	Status       string       `json:"status"`
	CreatedAt    httpx.JSTime `json:"created_at"`
	UpdatedAt    httpx.JSTime `json:"updated_at"`
}

// ReviewStatuses are the moderation states.
var ReviewStatuses = []string{"pending", "published", "rejected"}

// ListReviews is the moderation list, newest first, optionally by status.
func (s *Service) ListReviews(ctx context.Context, status string) ([]ReviewRow, error) {
	rows, err := s.db.Query(ctx, `SELECT r.id::text, r.product_id::text, COALESCE(i.product_name, ''), o.customer_name, o.order_number,
		  r.rating, r.comment, r.status, r.created_at, r.updated_at
		FROM shop.product_reviews r
		JOIN shop.orders o ON o.id = r.order_id
		LEFT JOIN LATERAL (SELECT product_name FROM shop.order_items WHERE order_id = r.order_id AND product_id = r.product_id LIMIT 1) i ON true
		WHERE $1 = '' OR r.status = $1
		ORDER BY r.created_at DESC LIMIT 200`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ReviewRow{}
	for rows.Next() {
		var r ReviewRow
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&r.ID, &r.ProductID, &r.ProductName, &r.CustomerName, &r.OrderNumber, &r.Rating, &r.Comment, &r.Status,
			&createdAt, &updatedAt); err != nil {
			return nil, err
		}
		r.CreatedAt, r.UpdatedAt = httpx.JSTime(createdAt), httpx.JSTime(updatedAt)
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReviewStatusView is PATCH /api/shop/reviews/{id}.
type ReviewStatusView struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// ModerateReview sets a review's status.
func (s *Service) ModerateReview(ctx context.Context, id, status string) (*ReviewStatusView, error) {
	tag, err := s.db.Exec(ctx, `UPDATE shop.product_reviews SET status = $2, updated_at = now() WHERE id = $1::uuid`, id, status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errReviewNotFound
	}
	return &ReviewStatusView{ID: id, Status: status}, nil
}
