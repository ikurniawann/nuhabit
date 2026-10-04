package accounting

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/inventory"
	"nuhabit/backend/internal/contracts/payroll"
	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
)

// Outbox subscribers: the journals the TS posted inline after POS sales,
// member bill instalments, GRNs, purchase returns and stock movements, plus
// the payroll journals of a paid run (new in Go).
// Subscriber names are contracts; renaming one drops its pending deliveries.

// subscribe registers every journal subscriber on bus.
func (s *Service) subscribe(bus *outbox.Bus) {
	bus.Subscribe(possales.TopicSaleSettled, "accounting.journal-pos-sale", handle(s, func(ctx context.Context, tx pgx.Tx, in possales.SaleSettled) ([]domain.PostResult, error) {
		return s.PostPosSale(ctx, tx, in)
	}))
	// Orders a member bill settles arrive as pos.sale.completed from stored
	// value (payment_method member_bill); other methods come as SaleSettled.
	bus.Subscribe(possales.TopicSaleCompleted, "accounting.journal-member-bill-sale", handle(s, func(ctx context.Context, tx pgx.Tx, in possales.SaleCompleted) ([]domain.PostResult, error) {
		if !strings.EqualFold(strings.TrimSpace(in.PaymentMethod), "member_bill") {
			return nil, nil
		}
		method := in.PaymentMethod
		return s.PostPosSale(ctx, tx, possales.SaleSettled{OrderID: in.OrderID, PaymentMethod: &method})
	}))
	bus.Subscribe(storedvalue.TopicMemberBillPaid, "accounting.journal-member-deposit", handle(s, func(ctx context.Context, tx pgx.Tx, in storedvalue.MemberBillPaid) ([]domain.PostResult, error) {
		r, err := s.PostMemberDeposit(ctx, tx, in)
		return []domain.PostResult{r}, err
	}))
	bus.Subscribe(procurement.TopicGrnPosted, "accounting.journal-grn", handle(s, func(ctx context.Context, tx pgx.Tx, in procurement.GrnPosted) ([]domain.PostResult, error) {
		return s.PostGrn(ctx, tx, in)
	}))
	bus.Subscribe(procurement.TopicPurchaseReturnApproved, "accounting.journal-purchase-return", handle(s, func(ctx context.Context, tx pgx.Tx, in procurement.PurchaseReturnApproved) ([]domain.PostResult, error) {
		r, err := s.PostPurchaseReturn(ctx, tx, in)
		return []domain.PostResult{r}, err
	}))
	bus.Subscribe(inventory.TopicStockOpnameCompleted, "accounting.journal-stock-opname", handle(s, func(ctx context.Context, tx pgx.Tx, in inventory.StockOpnameCompleted) ([]domain.PostResult, error) {
		return s.PostStockOpname(ctx, tx, in)
	}))
	bus.Subscribe(inventory.TopicStockAdjusted, "accounting.journal-stock-adjustment", handle(s, func(ctx context.Context, tx pgx.Tx, in inventory.StockAdjusted) ([]domain.PostResult, error) {
		r, err := s.PostStockAdjustment(ctx, tx, in)
		return []domain.PostResult{r}, err
	}))
	bus.Subscribe(inventory.TopicStockTransferred, "accounting.journal-stock-transfer", handle(s, func(ctx context.Context, tx pgx.Tx, in inventory.StockTransferred) ([]domain.PostResult, error) {
		r, err := s.PostStockTransfer(ctx, tx, in)
		return []domain.PostResult{r}, err
	}))
	bus.Subscribe(payroll.TopicRunPaid, "accounting.journal-payroll-run", handle(s, func(ctx context.Context, tx pgx.Tx, in payroll.RunPaid) ([]domain.PostResult, error) {
		return s.PostPayrollRun(ctx, tx, in)
	}))
}

// handle decodes the payload and posts. Like the TS callers, a journal that
// cannot post (closed period, missing source, bad mapping) is logged and the
// event is done; only infrastructure errors return, so the bus retries.
func handle[T any](s *Service, post func(context.Context, pgx.Tx, T) ([]domain.PostResult, error)) outbox.Handler {
	return func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var in T
		if err := e.Decode(&in); err != nil {
			s.log.ErrorContext(ctx, "accounting: undecodable event", "topic", e.Topic, "event_id", e.ID, "error", err)
			return nil
		}
		results, err := post(ctx, tx, in)
		if err != nil {
			var pe *PostError
			var he *httpx.Error
			if errors.As(err, &pe) || errors.As(err, &he) || errors.Is(err, ErrSourceMissing) {
				s.log.WarnContext(ctx, "accounting: journal not posted", "topic", e.Topic, "key", e.Key, "error", errMessage(err))
				return nil
			}
			return err
		}
		if note := domain.Summarize(results...); note != "" {
			s.log.InfoContext(ctx, "accounting: journal", "topic", e.Topic, "key", e.Key, "note", note)
		}
		return nil
	}
}
