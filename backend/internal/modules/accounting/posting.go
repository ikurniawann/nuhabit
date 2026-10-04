package accounting

import (
	"context"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
)

// Posting through journal mappings (journal-mapping-posting.ts): an
// operational event plus an amount bag becomes an AUTO POSTED entry keyed by
// (event code, source document), so a repeat is a no-op.

// MappingPost is PostFromMappingInput.
type MappingPost struct {
	CompanyID    *string
	UserID       string
	EventCode    string
	DocumentType string
	DocumentID   string
	EntryDate    string
	Amounts      domain.Amounts
	Description  string
	SourceModule string // default PURCHASING, as in the TS
}

type mappingHeader struct {
	ID        string
	CompanyID *string
}

// activeMappingLines is resolveActiveMapping: the company mapping of the
// event, else the global template; nil when neither is active.
func activeMappingLines(ctx context.Context, q database.Querier, eventCode string, companyID *string) ([]domain.MappingLine, bool, error) {
	m, err := one[mappingHeader](ctx, q, `
SELECT id::text, company_id::text
  FROM accounting.journal_mappings
 WHERE deleted_at IS NULL
   AND is_active = true
   AND event_code = $1
   AND (($2::uuid IS NOT NULL AND company_id = $2::uuid) OR company_id IS NULL)
 ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END ASC
 LIMIT 1`, eventCode, companyID)
	if err != nil || m == nil {
		return nil, false, err
	}
	lines, err := collect[domain.MappingLine](ctx, q, `
SELECT l.entry_side, l.account_id::text, l.amount_source, l.sort_order, l.is_required, l.line_role
  FROM accounting.journal_mapping_lines l
 WHERE l.mapping_id = $1::uuid
 ORDER BY l.sort_order ASC, l.entry_side ASC`, m.ID)
	return lines, true, err
}

func existingResult(e *JournalEntry) domain.PostResult {
	status := domain.PostDraft
	if e.Status == domain.StatusPosted {
		status = domain.PostPosted
	}
	return domain.PostResult{Status: status, EntryID: e.ID, Reason: domain.AlreadyExists}
}

// PostFromMapping is postJournalFromMapping on db (the pool, or the caller's
// transaction where it nests as a savepoint):
//   - an entry already exists for the source -> that entry (already_exists)
//   - no active mapping -> skipped
//   - mapping incomplete -> draft with the reason, nothing written
//   - ready -> AUTO POSTED entry; a technical or fiscal failure is a *PostError.
func PostFromMapping(ctx context.Context, db database.DB, in MappingPost) (domain.PostResult, error) {
	existing, err := findEntryBySource(ctx, db, in.CompanyID, in.EventCode, in.DocumentID)
	if err != nil {
		return domain.PostResult{}, err
	}
	if existing != nil {
		return existingResult(existing), nil
	}
	lines, found, err := activeMappingLines(ctx, db, in.EventCode, in.CompanyID)
	if err != nil {
		return domain.PostResult{}, err
	}
	if !found {
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Tidak ada journal mapping aktif untuk " + in.EventCode}, nil
	}
	memo := in.Description
	journal, reason := domain.BuildFromMapping(lines, in.Amounts, &memo)
	if reason != "" {
		return domain.PostResult{Status: domain.PostDraft, Reason: reason}, nil
	}
	module := in.SourceModule
	if module == "" {
		module = "PURCHASING"
	}
	return postAuto(ctx, db, in.CompanyID, in.UserID, in.EventCode, in.DocumentType, in.DocumentID, in.EntryDate, in.Description, module, journal)
}

// postAuto creates the AUTO POSTED entry of a source document. A unique
// race returns the winner's entry; any other failure is a *PostError.
func postAuto(ctx context.Context, db database.DB, companyID *string, userID, eventCode, docType, docID, entryDate, description, module string, lines []domain.Line) (domain.PostResult, error) {
	entry, err := createEntry(ctx, db, NewEntry{
		UserID: userID, CompanyID: companyID, EntryDate: entryDate, Description: &description,
		Lines: lines, Post: true, EntryType: domain.EntryAuto,
		SourceModule: &module, SourceEventCode: &eventCode, SourceDocumentType: &docType, SourceDocumentID: &docID,
	})
	if err == nil {
		return domain.PostResult{Status: domain.PostPosted, EntryID: entry.ID}, nil
	}
	message := errMessage(err)
	if uniqueRace.MatchString(message) {
		again, ferr := findEntryBySource(ctx, db, companyID, eventCode, docID)
		if ferr != nil {
			return domain.PostResult{}, ferr
		}
		if again != nil {
			return existingResult(again), nil
		}
	}
	return domain.PostResult{}, &PostError{Message: "Gagal posting jurnal " + eventCode + ": " + message}
}
