package gymtraining

import (
	"maps"
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

/* ── Staff: revenue-share commission ─────────────────────────────────── */

func (h handlers) commissionRoutes() []module.Route {
	inc := iam.GymIncentives
	return []module.Route{
		{Pattern: "GET /api/gym/incentives/commission", Handler: auth.Staff(h.guard, h.commission, iam.Can(actRead, inc))},
		// Saving a draft creates, approving updates: the body says which.
		{Pattern: "POST /api/gym/incentives/commission", Handler: h.upsert(inc, h.actOnCommission)},
		{Pattern: "POST /api/gym/incentives/commission/lines/{id}", Handler: auth.Staff(h.guard, h.payCommissionLine, iam.Can(actUpdate, inc))},
		{Pattern: "GET /api/gym/incentives/commission/settings", Handler: auth.Staff(h.guard, h.commissionSettings, iam.Can(actRead, inc))},
		{Pattern: "POST /api/gym/incentives/commission/settings", Handler: h.upsert(inc, h.saveCommissionScheme)},
		{Pattern: "DELETE /api/gym/incentives/commission/settings", Handler: auth.Staff(h.guard, h.deleteCommissionScheme, iam.Can(actDelete, inc))},
		{Pattern: "PUT /api/gym/incentives/commission/coaches/{id}", Handler: auth.Staff(h.guard, h.saveCoachProfile, iam.Can(actUpdate, inc))},
		{Pattern: "GET /api/gym/my-classes/commission", Handler: auth.Staff(h.guard, h.myCommission, iam.Can(actRead, iam.GymMyClasses))},
	}
}

var monthCheck = validate.StrOpts{Check: func(s string) (string, string, bool) {
	return "custom", badMonth, domain.IsPeriodMonth(s)
}}

func (h handlers) commission(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	month := q.Get("month")
	if !domain.IsPeriodMonth(month) {
		return httpx.BadRequest(badMonth)
	}
	var branchID *string
	if raw := q.Get("branch_id"); raw != "" {
		if !validate.IsUUID(raw) {
			return httpx.BadRequest("ID cabang tidak valid")
		}
		branchID = &raw
	}
	out, err := h.svc.Commission(r.Context(), month, branchID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h handlers) actOnCommission(w http.ResponseWriter, r *http.Request, u *auth.User, require func(id *string) error) error {
	f := validate.New(validate.ReadBody(r))
	branchID := deref(f.UUID("branch_id", required))
	month := deref(f.Str("month", required, monthCheck))
	action := deref(f.Enum("action", required, commissionActions))
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	// require(nil) asks for create, require(&id) for update.
	var approving *string
	if action == commissionActionApprove {
		approving = &branchID
	}
	if err := require(approving); err != nil {
		return err
	}
	out, err := h.svc.ActOnCommission(r.Context(), u.ID, branchID, month, action)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h handlers) payCommissionLine(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	in := commissionPayInput{
		Method:           deref(f.Enum("method", required, []string{domain.PayByPayroll, domain.PayByCash, domain.PayByTransfer})),
		PaymentReference: trimmed(f.Str("payment_reference", optionalNull, validate.StrOpts{Trim: true, Max: 120})),
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	if err := h.svc.PayCommissionLine(r.Context(), u.ID, id, in); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func trimmed(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

func (h handlers) commissionSettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.CommissionSettings(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

var (
	percent       = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}
	incidentKind  = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
	maxDeductions = 20
)

func parseCommissionScheme(r *http.Request) (commissionSchemeInput, error) {
	f := validate.New(validate.ReadBody(r))
	d := domain.DefaultCommissionSettings
	num := func(key string, def float64) float64 {
		if v := f.Num(key, validate.Rule{HasDefault: true}, percent); v != nil {
			return *v
		}
		return def
	}
	in := commissionSchemeInput{
		ID:                    f.UUID("id", optional),
		BranchID:              f.UUID("branch_id", nullable),
		Name:                  deref(f.Str("name", required, validate.StrOpts{Trim: true, Min: 2, Max: 80})),
		ClassPoolPercent:      num("class_pool_percent", d.ClassPoolPercent),
		PtPoolPercent:         num("pt_pool_percent", d.PtPoolPercent),
		ShareHeadCoachPercent: num("share_head_coach_percent", d.ShareHeadCoachPercent),
		ShareCoachPercent:     num("share_coach_percent", d.ShareCoachPercent),
		ShareAssistantPercent: num("share_assistant_percent", d.ShareAssistantPercent),
		MaxDeductionPercent:   num("max_deduction_percent", d.MaxDeductionPercent),
		PayoutChannel:         deref(f.Enum("payout_channel", required, domain.PayoutChannels)),
		IsActive:              f.BoolDefault("is_active", true),
		DeductionPercents:     maps.Clone(d.DeductionPercents),
	}
	if _, sent := f.Fields()["deduction_percents"]; sent {
		child := f.Child("deduction_percents")
		in.DeductionPercents = map[string]float64{}
		for kind := range child.Fields() {
			if !incidentKind.MatchString(kind) {
				child.Fail(kind, "custom", "Jenis pelanggaran tidak valid")
				continue
			}
			if v := child.Num(kind, required, percent); v != nil {
				in.DeductionPercents[kind] = *v
			}
		}
		if len(in.DeductionPercents) > maxDeductions {
			f.Fail("deduction_percents", "custom", "Terlalu banyak jenis pelanggaran")
		}
	}
	return in, f.ErrAtPath("Data tidak valid")
}

func (h handlers) saveCommissionScheme(w http.ResponseWriter, r *http.Request, u *auth.User, require func(id *string) error) error {
	in, err := parseCommissionScheme(r)
	if err != nil {
		return err
	}
	if err := require(in.ID); err != nil {
		return err
	}
	out, err := h.svc.SaveCommissionScheme(r.Context(), in, u.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h handlers) deleteCommissionScheme(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.UUID(r.URL.Query().Get("id"))
	if err != nil {
		return err
	}
	if err := h.svc.DeleteCommissionScheme(r.Context(), id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h handlers) saveCoachProfile(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	role := deref(f.Enum("role", required, domain.CommissionRoles))
	share := f.Num("share_percent", nullable, percent)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	if err := h.svc.SaveCoachProfile(r.Context(), id, role, share, u.ID); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h handlers) myCommission(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	month := r.URL.Query().Get("month")
	if month == "" {
		month = domain.PeriodMonthOf(h.svc.now())
	}
	if !domain.IsPeriodMonth(month) {
		return httpx.BadRequest(badMonth)
	}
	out, err := h.svc.MyCommission(r.Context(), u.ID, month)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}
