package accounting

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Account types ───────────────────────────────────────────────────── */

func (h *Handler) listAccountTypes(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListAccountTypes(r.Context())
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{rows})
}

func (h *Handler) createAccountType(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseAccountType(r)
	if err != nil {
		return err
	}
	row, err := h.svc.CreateAccountType(r.Context(), u.ID, in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 201, dataMessage{row, "Account type berhasil ditambahkan"})
}

func (h *Handler) updateAccountType(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseAccountType(r)
	if err != nil {
		return err
	}
	row, err := h.svc.UpdateAccountType(r.Context(), r.PathValue("id"), u.ID, in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataMessage{row, "Account type berhasil diperbarui"})
}

func (h *Handler) deleteAccountType(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	if err := h.svc.DeleteAccountType(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	return httpx.JSON(w, 200, messageBody{"Account type berhasil dihapus"})
}

/* ── Chart of accounts ───────────────────────────────────────────────── */

var accountBoolFilters = []string{"is_postable", "is_contra", "is_cash_bank", "is_active"}

func (h *Handler) listAccounts(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if sc.CompanyID == nil {
		return httpx.JSON(w, 200, dataBody{[]any{}})
	}
	f := AccountFilters{AccountTypeID: raw(r, "account_type_id"), CashFlowCategory: raw(r, "cash_flow_category"), Search: query(r, "search")}
	for _, key := range accountBoolFilters {
		if v := raw(r, key); v == "true" || v == "false" {
			f.Bools = append(f.Bools, [2]string{key, v})
		}
	}
	rows, err := h.svc.ListAccounts(r.Context(), *sc.CompanyID, f)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{rows})
}

func (h *Handler) createAccount(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseAccount(r)
	if err != nil {
		return err
	}
	companyID, sc, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	row, err := h.svc.CreateAccount(r.Context(), u.ID, companyID, sc, in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 201, dataMessage{row, "Akun berhasil ditambahkan"})
}

func (h *Handler) updateAccount(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseAccount(r)
	if err != nil {
		return err
	}
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	row, err := h.svc.UpdateAccount(r.Context(), r.PathValue("id"), u.ID, sc, in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataMessage{row, "Akun berhasil diperbarui"})
}

func (h *Handler) deleteAccount(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteAccount(r.Context(), r.PathValue("id"), u.ID, sc); err != nil {
		return err
	}
	return httpx.JSON(w, 200, messageBody{"Akun berhasil dihapus"})
}

/* ── Journal mappings ────────────────────────────────────────────────── */

func (h *Handler) listMappings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if sc.CompanyID == nil {
		return httpx.JSON(w, 200, dataBody{[]any{}})
	}
	rows, err := h.svc.ListMappings(r.Context(), *sc.CompanyID, query(r, "search"), raw(r, "module"), raw(r, "is_active"))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{rows})
}

// mappingInput normalises the event code and fills the name (and, on
// create, the description) from JOURNAL_EVENT_META.
func mappingInput(b mappingBody, create bool) MappingInput {
	code := strings.ToUpper(jsTrim(b.EventCode))
	meta, known := domain.EventNames[code]
	name := jsTrim(b.Name)
	if name == "" {
		name = code
		if known {
			name = meta[0]
		}
	}
	desc := trimOrNull(b.Description)
	if desc == nil && create && known {
		desc = &meta[1]
	}
	return MappingInput{EventCode: code, Name: name, Description: desc, Module: b.Module, IsActive: b.IsActive, Lines: b.Lines}
}

func (h *Handler) createMapping(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	body, err := parseMapping(r)
	if err != nil {
		return err
	}
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	row, err := h.svc.CreateMapping(r.Context(), u.ID, companyID, mappingInput(body, true))
	if err != nil {
		return uniqueAs400(err, "Event code sudah ada untuk company ini")
	}
	return httpx.JSON(w, 201, dataMessage{row, "Journal mapping berhasil ditambahkan"})
}

var mappingScope = domain.RecordScopeMessages{NotFound: "Journal mapping tidak ditemukan", OutOfScope: "Mapping di luar scope"}

func (h *Handler) mappingInScope(r *http.Request, u *auth.User, global string) (*Mapping, error) {
	m, err := h.svc.Mapping(r.Context(), r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	sc, err := h.scope(r, u)
	if err != nil {
		return nil, err
	}
	msgs := mappingScope
	msgs.Global = global
	var company *string
	if m != nil {
		company = m.CompanyID
	}
	return m, rejection(sc.AssertRecordInScope(m != nil, company, msgs))
}

func (h *Handler) getMapping(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	m, err := h.mappingInScope(r, u, "")
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{m})
}

func (h *Handler) updateMapping(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	body, err := parseMapping(r)
	if err != nil {
		return err
	}
	existing, err := h.mappingInScope(r, u, "Tidak dapat mengubah template global")
	if err != nil {
		return err
	}
	row, err := h.svc.UpdateMapping(r.Context(), existing.ID, u.ID, existing.CompanyID, mappingInput(body, false))
	if err != nil {
		return uniqueAs400(err, "Event code sudah digunakan")
	}
	return httpx.JSON(w, 200, dataMessage{row, "Journal mapping berhasil diperbarui"})
}

func (h *Handler) deleteMapping(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, err := h.mappingInScope(r, u, "Tidak dapat menghapus template global"); err != nil {
		return err
	}
	if err := h.svc.DeleteMapping(r.Context(), r.PathValue("id"), u.ID); err != nil {
		return err
	}
	return httpx.JSON(w, 200, messageBody{"Journal mapping berhasil dihapus"})
}

/* ── Fiscal years ────────────────────────────────────────────────────── */

func (h *Handler) listFiscalYears(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if raw(r, "coverage") == "1" {
		date := query(r, "date")
		if date == "" {
			date = h.svc.today()
		}
		cov, err := h.svc.Coverage(r.Context(), date, sc.CompanyID)
		if err != nil {
			return err
		}
		return httpx.JSON(w, 200, dataBody{cov})
	}
	if sc.CompanyID == nil {
		return httpx.JSON(w, 200, dataBody{[]any{}})
	}
	rows, err := h.svc.ListFiscalYears(r.Context(), *sc.CompanyID, query(r, "search"), raw(r, "is_active"))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{rows})
}

func (h *Handler) createFiscalYear(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseFiscalYear(r)
	if err != nil {
		return err
	}
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	row, err := h.svc.CreateFiscalYear(r.Context(), u.ID, companyID, in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 201, dataMessage{row, "Fiscal year berhasil ditambahkan"})
}

var yearScope = domain.RecordScopeMessages{NotFound: "Fiscal year tidak ditemukan", OutOfScope: "Fiscal year di luar scope"}

func (h *Handler) yearInScope(r *http.Request, u *auth.User, global string) (*FiscalYear, error) {
	y, err := h.svc.FiscalYear(r.Context(), r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	sc, err := h.scope(r, u)
	if err != nil {
		return nil, err
	}
	msgs := yearScope
	msgs.Global = global
	var company *string
	if y != nil {
		company = y.CompanyID
	}
	return y, rejection(sc.AssertRecordInScope(y != nil, company, msgs))
}

func (h *Handler) getFiscalYear(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	y, err := h.yearInScope(r, u, "")
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{y})
}

func (h *Handler) updateFiscalYear(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseFiscalYear(r)
	if err != nil {
		return err
	}
	if _, err := h.yearInScope(r, u, "Tidak dapat mengubah fiscal year global"); err != nil {
		return err
	}
	row, err := h.svc.UpdateFiscalYear(r.Context(), r.PathValue("id"), u.ID, in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataMessage{row, "Fiscal year berhasil diperbarui"})
}

func (h *Handler) deleteFiscalYear(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, err := h.yearInScope(r, u, "Tidak dapat menghapus fiscal year global"); err != nil {
		return err
	}
	if err := h.svc.DeleteFiscalYear(r.Context(), r.PathValue("id"), u.ID); err != nil {
		return err
	}
	return httpx.JSON(w, 200, messageBody{"Fiscal year berhasil dihapus"})
}

func (h *Handler) getOpening(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, err := h.yearInScope(r, u, ""); err != nil {
		return err
	}
	data, err := h.svc.OpeningSuggestion(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{data})
}

func (h *Handler) saveOpening(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseOpening(r)
	if err != nil {
		return err
	}
	if _, err := h.yearInScope(r, u, "Tidak dapat mengubah fiscal year global"); err != nil {
		return err
	}
	data, err := h.svc.SaveOpening(r.Context(), r.PathValue("id"), u.ID, in.Lines, in.Post)
	if err != nil {
		return err
	}
	msg := "Beginning balance draft berhasil disimpan"
	if in.Post {
		msg = "Beginning balance berhasil diposting"
	}
	return httpx.JSON(w, 200, dataMessage{data, msg})
}

/* ── Fiscal periods ──────────────────────────────────────────────────── */

func (h *Handler) listPeriods(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	rows, err := h.svc.ListPeriods(r.Context(), companyID, raw(r, "fiscal_year_id"), raw(r, "status"), raw(r, "search"))
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, rows)
}

func (h *Handler) periodCompany(r *http.Request, u *auth.User) (string, error) {
	companyID, sc, err := h.company(r, u, "")
	if err != nil {
		return "", err
	}
	return companyID, h.svc.AssertPeriodInScope(r.Context(), r.PathValue("id"), sc)
}

func (h *Handler) openPeriod(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	closePrevious, err := parseClosePrevious(r)
	if err != nil {
		return err
	}
	companyID, err := h.periodCompany(r, u)
	if err != nil {
		return err
	}
	data, err := h.svc.OpenPeriod(r.Context(), r.PathValue("id"), u.ID, &companyID, closePrevious)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataMessage{data, "Period " + data.Name + " berhasil dibuka"})
}

func (h *Handler) closePreview(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, err := h.periodCompany(r, u)
	if err != nil {
		return err
	}
	data, err := h.svc.ClosePreview(r.Context(), r.PathValue("id"), companyID)
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, data)
}

func (h *Handler) closePeriod(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, err := h.periodCompany(r, u)
	if err != nil {
		return err
	}
	data, err := h.svc.ClosePeriod(r.Context(), r.PathValue("id"), u.ID, companyID)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, 200, data, "Period "+data.Name+" berhasil ditutup")
}

/* ── Journal entries ─────────────────────────────────────────────────── */

func (h *Handler) listEntries(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if sc.CompanyID == nil {
		return httpx.JSON(w, 200, dataBody{[]any{}})
	}
	rows, err := h.svc.ListJournalEntries(r.Context(), JournalFilters{
		Search: query(r, "search"), Status: raw(r, "status"), DateFrom: raw(r, "date_from"), DateTo: raw(r, "date_to"),
		EntryType: raw(r, "entry_type"), AccountID: raw(r, "account_id"), CompanyID: *sc.CompanyID,
	})
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{rows})
}

func entryMessage(post bool, draft string) string {
	if post {
		return "Journal entry berhasil diposting"
	}
	return draft
}

func (h *Handler) createEntry(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseJournal(r)
	if err != nil {
		return err
	}
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	row, err := h.svc.CreateJournalEntry(r.Context(), NewEntry{UserID: u.ID, CompanyID: &companyID, EntryDate: in.EntryDate,
		Description: trimOrNull(in.Description), Lines: in.Lines, Post: in.Post})
	if err != nil {
		return err
	}
	return httpx.JSON(w, 201, dataMessage{row, entryMessage(in.Post, "Journal entry draft berhasil disimpan")})
}

var entryScope = domain.RecordScopeMessages{NotFound: "Journal entry tidak ditemukan", OutOfScope: "Journal entry di luar scope"}

func (h *Handler) entryInScope(r *http.Request, u *auth.User, global string) (*JournalEntry, domain.Scope, error) {
	e, err := h.svc.JournalEntry(r.Context(), r.PathValue("id"))
	if err != nil {
		return nil, domain.Scope{}, err
	}
	sc, err := h.scope(r, u)
	if err != nil {
		return nil, sc, err
	}
	msgs := entryScope
	msgs.Global = global
	var company *string
	if e != nil {
		company = e.CompanyID
	}
	return e, sc, rejection(sc.AssertRecordInScope(e != nil, company, msgs))
}

func (h *Handler) getEntry(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	e, _, err := h.entryInScope(r, u, "")
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{e})
}

func (h *Handler) updateEntry(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parseJournal(r)
	if err != nil {
		return err
	}
	existing, sc, err := h.entryInScope(r, u, "Tidak dapat mengubah journal entry global")
	if err != nil {
		return err
	}
	companyID := existing.CompanyID
	if companyID == nil {
		id, err := sc.RequireCompany("")
		if err != nil {
			return rejection(err)
		}
		companyID = &id
	}
	row, err := h.svc.UpdateJournalEntry(r.Context(), EntryUpdate{ID: existing.ID, UserID: u.ID, CompanyID: companyID,
		EntryDate: in.EntryDate, Description: trimOrNull(in.Description), Lines: in.Lines, Post: in.Post})
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataMessage{row, entryMessage(in.Post, "Journal entry berhasil diperbarui")})
}

func (h *Handler) deleteEntry(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, _, err := h.entryInScope(r, u, "Tidak dapat menghapus journal entry global"); err != nil {
		return err
	}
	if err := h.svc.DeleteJournalEntry(r.Context(), r.PathValue("id"), u.ID); err != nil {
		return err
	}
	return httpx.JSON(w, 200, messageBody{"Journal entry berhasil dihapus"})
}

func (h *Handler) postEntry(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, _, err := h.entryInScope(r, u, ""); err != nil {
		return err
	}
	row, err := h.svc.PostJournalEntry(r.Context(), r.PathValue("id"), u.ID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataMessage{row, "Journal entry berhasil diposting"})
}
