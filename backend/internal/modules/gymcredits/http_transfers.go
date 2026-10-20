package gymcredits

import (
	"net/http"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// transferRoutes: staff move credits between members (update on the credits
// menu, like adjust); members send their own when the rules allow it.
func (h *Handler) transferRoutes() []module.Route {
	return []module.Route{
		{Pattern: "POST /api/gym/credits/{customerId}/transfer", Handler: h.api(h.transfer)},
		{Pattern: "POST /api/member-portal/gym/credits/transfer", Handler: h.auth.MemberHandler("Gagal mengirim kredit", h.memberTransfer)},
	}
}

var transferKeyRule = strRule{trim: true, min: 8, minMsg: "Kunci transfer tidak valid", max: 100}

type transferBody struct {
	ToCustomerID   string
	Credits        int
	Lots           []domain.TransferPick
	Note           string
	IdempotencyKey string
	BranchID       *string
}

// parseTransfer reads { to_customer_id, credits?, lots?: [{lot_id, credits}],
// note?, idempotency_key, branch_id? }; lots or credits must be sent.
func parseTransfer(body any) (transferBody, error) {
	f := newForm(body)
	var b transferBody
	b.ToCustomerID, _ = f.str("to_customer_id", strRule{uuid: true, uuidMsg: "Pilih member penerima"})
	credits, _ := f.num("credits", numRule{integer: true, intMsg: "Jumlah kredit harus bilangan bulat", min: bound(1),
		minMsg: "Minimal 1 kredit", max: bound(1000), optional: true})
	b.Credits = int(credits)
	b.Lots = f.transferLots("lots")
	b.Note, _ = f.str("note", strRule{trim: true, max: 300, optional: true, nullable: true})
	b.IdempotencyKey, _ = f.str("idempotency_key", transferKeyRule)
	b.BranchID = optString(f.str("branch_id", strRule{uuid: true, optional: true, nullable: true}))
	if f.obj != nil && len(f.issues) == 0 && b.Credits == 0 && len(b.Lots) == 0 {
		f.add(issue{Code: "custom", Path: []any{"credits"}, Message: "Isi jumlah kredit atau pilih lot"})
	}
	return b, f.staffErr()
}

// transferLots validates z.array({lot_id: uuid, credits: int >= 1}).optional().
func (f *form) transferLots(key string) []domain.TransferPick {
	v := f.get(key)
	if f.skip(v, true, true) {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		f.add(typeIssue([]any{key}, "array", v, ""))
		return nil
	}
	out := make([]domain.TransferPick, 0, len(arr))
	for i, el := range arr {
		obj, ok := el.(map[string]any)
		if !ok {
			f.add(typeIssue([]any{key, i}, "object", el, ""))
			continue
		}
		item := &form{obj: obj}
		lotID, _ := item.str("lot_id", strRule{uuid: true, uuidMsg: "Lot tidak valid"})
		credits, _ := item.num("credits", numRule{integer: true, intMsg: "Jumlah kredit harus bilangan bulat", min: bound(1),
			minMsg: "Minimal 1 kredit", max: bound(1000)})
		for _, is := range item.issues {
			is.Path = append([]any{key, i}, is.Path...)
			f.add(is)
		}
		out = append(out, domain.TransferPick{LotID: lotID, Credits: int(credits)})
	}
	return out
}

type memberTransferBody struct {
	Phone          string
	Credits        int
	Note           string
	IdempotencyKey string
}

func parseMemberTransfer(body any) (memberTransferBody, error) {
	f := newForm(body)
	var b memberTransferBody
	b.Phone, _ = f.str("phone", strRule{trim: true, min: 8, minMsg: "Masukkan nomor HP penerima", max: 20})
	credits, _ := f.num("credits", numRule{integer: true, intMsg: "Jumlah kredit harus bilangan bulat", min: bound(1),
		minMsg: "Minimal 1 kredit", max: bound(1000)})
	b.Credits = int(credits)
	b.Note, _ = f.str("note", strRule{trim: true, max: 200, optional: true, nullable: true})
	b.IdempotencyKey, _ = f.str("idempotency_key", transferKeyRule)
	return b, f.memberErr()
}

func (h *Handler) transfer(w http.ResponseWriter, r *http.Request) error {
	user, err := h.require(r, actUpdate, iam.GymCredits)
	if err != nil {
		return err
	}
	from, err := requireUUID(r.PathValue("customerId"))
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	in, err := parseTransfer(body)
	if err != nil {
		return err
	}
	res, err := h.svc.TransferTx(r.Context(), TransferInput{
		FromCustomerID: from, ToCustomerID: in.ToCustomerID, Credits: in.Credits, Lots: in.Lots, Note: in.Note,
		IdempotencyKey: "staff:" + in.IdempotencyKey, Channel: TransferByStaff, ActorID: user.ID, BranchID: in.BranchID,
	})
	if err != nil {
		return err
	}
	return ok(w, res)
}

func (h *Handler) memberTransfer(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readJSON(r, map[string]any{})
	in, err := parseMemberTransfer(body)
	if err != nil {
		return err
	}
	res, err := h.svc.MemberTransfer(r.Context(), customerID, in.Phone, in.Credits, in.Note, in.IdempotencyKey)
	if err != nil {
		return asHTTP(err)
	}
	return ok(w, res)
}
