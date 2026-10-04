package salesfunnel

import (
	"context"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Ports reach data owned by other bounded contexts. internal/app wires the
// adapters (adapters_salesfunnel.go) with the SQL the TS libs ran inline.
// Read-only joins for display labels (configuration.users full_name,
// branches and companies names, pos_customers names in the agenda) stay in
// this module's SQL, as in the TS.
type Ports struct {
	Directory   Directory
	Catalog     Catalog
	Stock       Stock
	Members     Members
	CRM         CRM
	Receivables Receivables
	// Gateway resolves the WhatsApp gateway; nil uses platform/whatsapp.
	Gateway Gateway
}

// Directory reads staff users (configuration.users).
type Directory interface {
	// Owners is listOwners: active sales/admin/super_admin/marketing/hrd
	// users of the company (or without one), at most 200.
	Owners(ctx context.Context, q database.Querier, companyID *string) ([]*pgrow.Row, error)
	// Assignee returns role and company_id of a user, found=false when missing.
	Assignee(ctx context.Context, q database.Querier, userID string) (role string, companyID *string, found bool, err error)
	// ForecastUsers lists active sales/admin/super_admin users of the
	// company (or without one) ordered by name; onlyUserID narrows to one.
	ForecastUsers(ctx context.Context, q database.Querier, companyID, onlyUserID *string) ([]domain.ForecastUser, error)
}

// RecipeItem is one validated recipe line.
type RecipeItem struct {
	RawMaterialID   string
	QuantityPerUnit float64
	WastePercentage float64
}

// ProductQty is a quotation product line for the material requirement.
type ProductQty struct {
	ProductID string
	Qty       string // numeric text, kept exact
}

// Catalog reads the POS catalog and the item master.
type Catalog interface {
	// Products is listCatalogProducts: active pos_products id, name, base_price.
	Products(ctx context.Context, q database.Querier) ([]*pgrow.Row, error)
	// ActiveProductCount counts the active products among ids.
	ActiveProductCount(ctx context.Context, q database.Querier, ids []string) (int, error)
	// SearchRawMaterials is searchRawMaterials (q has at least 2 characters).
	SearchRawMaterials(ctx context.Context, q database.Querier, term string, companyID, branchID *string) ([]*pgrow.Row, error)
	// Recipe is getRecipe.
	Recipe(ctx context.Context, q database.Querier, productID string) ([]*pgrow.Row, error)
	// ReplaceRecipe is replaceRecipe's transaction body on tx: 400s come
	// back as *httpx.Error.
	ReplaceRecipe(ctx context.Context, tx database.Querier, productID string, items []RecipeItem) error
	// MaterialNeeds sums qty × quantity_per_unit × (1 + waste%) per raw
	// material over the active recipes of the products.
	MaterialNeeds(ctx context.Context, q database.Querier, lines []ProductQty) ([]domain.MaterialRequirement, error)
	// ProductsWithoutRecipe lists the distinct names of the products that
	// have no active recipe.
	ProductsWithoutRecipe(ctx context.Context, q database.Querier, productIDs []string) ([]string, error)
}

// MaterialInfo labels a raw material in a shortage.
type MaterialInfo struct {
	Kode, Satuan *string
	Nama         string
	Found        bool
}

// StockMove is one realisation movement.
type StockMove struct {
	Step        domain.StockDeduction
	QuotationID string
	QuoteNumber string
	UserID      string
	BranchID    string
}

// Stock is the inventory side of a quotation realisation. It runs on the
// caller's transaction because the 409 shortage response and the frozen
// quotation depend on it (rule 2).
type Stock interface {
	// LockStock locks the venue's active inventory rows of the materials,
	// ordered by id (FOR UPDATE).
	LockStock(ctx context.Context, tx database.Querier, branchID string, materialIDs []string) ([]domain.StockRow, error)
	Material(ctx context.Context, tx database.Querier, id string) (MaterialInfo, error)
	// Deduct updates the inventory row and writes the 'out' movement.
	Deduct(ctx context.Context, tx database.Querier, m StockMove) error
}

// PicLead is the lead data a member is created from.
type PicLead struct {
	OrgName, PicName, PicPhone string
	PicEmail, City             *string
}

// Members reads and enrols loyalty members (pos.pos_customers, CRM
// member profiles) and their POS orders.
type Members interface {
	// Search is searchCustomers (q has at least 3 characters).
	Search(ctx context.Context, q database.Querier, term, phoneLike string) ([]*pgrow.Row, error)
	// Summary is the 360° member card; nil when missing.
	Summary(ctx context.Context, q database.Querier, id string) (*pgrow.Row, error)
	// RecentOrders lists the member's last five POS orders.
	RecentOrders(ctx context.Context, q database.Querier, customerID string) ([]*pgrow.Row, error)
	// UpsertFromPic is upsertCustomerFromPic: upsert by phone and enrol the
	// regular loyalty tier; "" when nothing was returned.
	UpsertFromPic(ctx context.Context, db database.DB, lead PicLead) (string, error)
}

// CRM reads CRM-owned configuration and logs.
type CRM interface {
	// CustomFieldDefs is loadCustomFieldDefs.
	CustomFieldDefs(ctx context.Context, q database.Querier, object string, companyID *string) ([]domain.CustomFieldDef, error)
	// CustomFieldRows is loadCustomFieldDefs as rows (the custom-fields route).
	CustomFieldRows(ctx context.Context, q database.Querier, object string, companyID *string) ([]*pgrow.Row, error)
	// DefaultVenue reads default_company_id/default_branch_id from
	// crm.crm_settings (string values only; nil when unset or the table is
	// missing).
	DefaultVenue(ctx context.Context, q database.Querier) (companyID, branchID *string, err error)
	// WaMessages lists crm.wa_messages whose phone ends with one of the
	// 9-digit suffixes, newest first, at most 100.
	WaMessages(ctx context.Context, q database.Querier, suffixes []string) ([]*pgrow.Row, error)
}

// Receivables posts the AR invoice of a sent sales invoice. The PATCH
// response names the AR number (or the failure), so it runs in-process.
type Receivables interface {
	// CreateFromSalesInvoice returns the AR invoice number and the journal
	// note (nil when none).
	CreateFromSalesInvoice(ctx context.Context, db database.DB, salesInvoiceID, userID string) (invoiceNo string, note *string, err error)
}

// Gateway resolves the self-hosted WhatsApp gateway (nil when unset).
type Gateway interface {
	LoadGateway(ctx context.Context, q database.Querier) *whatsapp.Gateway
}
