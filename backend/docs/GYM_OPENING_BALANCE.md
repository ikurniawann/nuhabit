# Gym deferred revenue: opening balance and lot backfill

Gym package journals (`internal/modules/gymcredits/journals.go`, mappings
`GYM_*` on the journal mapping page) started with migration
`20261021110000`. Packages sold before it never put money into deferred
revenue, yet their later usage, breakage and refunds post against it.
`cmd/gym-opening-balance` closes that gap once.

```
cd backend
go run ./cmd/gym-opening-balance -dry-run   # list per member and per purchase, write nothing
go run ./cmd/gym-opening-balance            # pin, mark and publish
```

Target: `DATABASE_URL` (shell env, then `.env.local`, then `.env`). A
remote target needs `-allow-remote` or `ALLOW_REMOTE_DB=1`. `-user <uuid>`
records a user on the journals. Run it while the API is up: the journals go
through the outbox and the API's accounting subscriber posts them.

## What it does

1. **Backfill lot ids.** Deductions, class refunds, admin adjustments and
   reversals written before entries recorded their lot form a pool that the
   ledger allocates FIFO (`domain.LotRemainders`). The command pins each of
   them to the lots that FIFO would draw (`domain.PlanBackfill`): credits
   out come off the lots earliest expiry first, a class refund goes back to
   the lots its booking drew from, a reversal follows the entry it reverses.
   An entry that spans several lots is split into one row per lot (the copy
   keeps the created_at, source and note; its idempotency key gets a `#bfN`
   suffix). An entry that was reversed is only pinned when one lot takes all
   of it. Before writing, the plan is checked against the current remaining
   credits of every lot: a member whose lots would change is skipped and
   listed. Later usage, breakage and refunds of those members then value
   the right lot.

2. **Opening balance per company.** For every active company, every paid
   purchase with a price that has no `GYM_SALE_*` journal (none in
   `accounting.journal_entries`, none waiting in the outbox) and no
   `opening_batch_id`:

   - credit pack: the credits still in its lot (pool-aware, lapsed credits
     count until the expiry sweep takes them) at the lot's unit price in sen
     (`domain.UnusedValueSen`), plus what the lot's journals already
     recognised (usage, breakage, adjustment, transfer out, less usage
     reversals) without a sale ever funding them;
   - pass: the days still to come at the daily price
     (`total - domain.PassRevenueDue(today)`), plus the daily releases already
     posted; a refunded pass contributes only its posted releases.

   The company gets one `GYM_OPENING_BALANCE` journal (debit the opening
   balance equity account, credit gym deferred revenue, mapping created by
   migration `20261023110000`) for the sum, document `gym_opening_batch`
   with a fresh batch id, dated today in Jakarta. Every scanned purchase is
   marked with the batch id, so a second run finds nothing, and a purchase
   worth zero is marked too.

   The company of a purchase is its branch's, else its package's branch's,
   else the only company, else the gym rule `defaultCompanyId` (Gym ->
   Aturan Gym, global rules). A purchase with no company is not listed;
   set the rule and run again.

Going forward, every lot is valued in sen and its journals net to zero when
its last credit leaves (`domain/valuation.go`): usage, breakage, admin
adjustments (`GYM_CREDIT_ADJUSTMENT`), the sen left over at a purchase refund
and cross-company transfers (`GYM_TRANSFER_OUT` / `GYM_TRANSFER_IN` through
the intercompany accounts). Bonus and adjustment lots carry no money and
post nothing, so referral bonus credits never touch the ledger; the ARK
Coin side of a referral bonus posts `WALLET_REFERRAL_BONUS` (promotion
expense to the ARK Coin liability).
