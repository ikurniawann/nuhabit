package recruitment

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/database"
)

// Live monitoring WebRTC signaling lives in recruitment.live_signals so HR
// and the candidate may reach different replicas. Every read keeps only
// offers younger than domain.SignalTTL at the caller's clock.

// PutOffer stores an HR offer and drops expired rows and, past three per
// session, the oldest offers. Re-posting an offer id moves it to the end, as
// the TS store appended it.
func (Postgres) PutOffer(ctx context.Context, db database.DB, sessionType, sessionID, offerID, sdp string, now time.Time) error {
	return database.WithTx(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM recruitment.live_signals
     WHERE created_at <= $1 OR (session_type = $2 AND session_id = $3 AND offer_id = $4)`,
			now.Add(-domain.SignalTTL), sessionType, sessionID, offerID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO recruitment.live_signals (session_type, session_id, offer_id, offer_sdp, created_at)
     VALUES ($1, $2, $3, $4, $5)`, sessionType, sessionID, offerID, sdp, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM recruitment.live_signals
     WHERE session_type = $1 AND session_id = $2
       AND id NOT IN (SELECT id FROM recruitment.live_signals WHERE session_type = $1 AND session_id = $2
                      ORDER BY id DESC LIMIT $3)`, sessionType, sessionID, domain.MaxOffersPerSession)
		return err
	})
}

// PendingOffers lists the live offers the candidate has not answered.
func (Postgres) PendingOffers(ctx context.Context, db database.Querier, sessionType, sessionID string, now time.Time) ([]domain.PendingOffer, error) {
	rows, err := db.Query(ctx, `SELECT offer_id, offer_sdp FROM recruitment.live_signals
     WHERE session_type = $1 AND session_id = $2 AND created_at > $3 AND answer_sdp IS NULL
     ORDER BY id`, sessionType, sessionID, now.Add(-domain.SignalTTL))
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[domain.PendingOffer])
	if out == nil {
		out = []domain.PendingOffer{}
	}
	return out, err
}

// AnswerOffer stores the candidate's answer; false when the offer is unknown
// or expired.
func (Postgres) AnswerOffer(ctx context.Context, db database.Querier, sessionType, sessionID, offerID, sdp string, now time.Time) (bool, error) {
	tag, err := db.Exec(ctx, `UPDATE recruitment.live_signals SET answer_sdp = $5
     WHERE session_type = $1 AND session_id = $2 AND offer_id = $3 AND created_at > $4`,
		sessionType, sessionID, offerID, now.Add(-domain.SignalTTL), sdp)
	return tag.RowsAffected() > 0, err
}

// OfferAnswer returns the answer to a live offer, nil until answered.
func (Postgres) OfferAnswer(ctx context.Context, db database.Querier, sessionType, sessionID, offerID string, now time.Time) (*string, error) {
	var answer *string
	err := db.QueryRow(ctx, `SELECT answer_sdp FROM recruitment.live_signals
     WHERE session_type = $1 AND session_id = $2 AND offer_id = $3 AND created_at > $4`,
		sessionType, sessionID, offerID, now.Add(-domain.SignalTTL)).Scan(&answer)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return answer, err
}
