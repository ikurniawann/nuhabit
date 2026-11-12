package procurement

import (
	"slices"

	"nuhabit/backend/internal/platform/iam"
)

// Menu prefixes per route group: each lists the Items sub-modules whose
// dashboard pages call the routes. Product and raw material purchasing share
// the transactional routes (module_type picks the side), so both pass.
var (
	// purchasingDocs: PR, PO, GRN and QC screens of the purchasing menus.
	purchasingDocs = slices.Concat(iam.ItemsPurchasing, iam.ItemsGeneralPurchasing)
	// approvalQueues: PR list and purchasing dashboard, also read by the
	// approval queues.
	approvalQueues = slices.Concat(purchasingDocs, iam.ItemsApproval)
	// poReaders: the PO list also feeds the approval queue and the
	// production additional cost picker.
	poReaders = slices.Concat(approvalQueues, iam.ItemsProduction)
	// grnReaders: the GRN list also feeds the production additional cost picker.
	grnReaders = slices.Concat(purchasingDocs, iam.ItemsProduction)
	// poPayables: PO detail, actions, payment terms and vendor credits, also
	// opened from Accounting payables.
	poPayables = slices.Concat(purchasingDocs, iam.ItemsPayables)
	// vendorPayers: product and general invoice pages plus Accounting payables.
	vendorPayers = slices.Concat(iam.ItemsProductPurchasing, iam.ItemsGeneralPurchasing, iam.ItemsPayables)
	// supplierReaders: supplier picker on PO, return and report filters.
	supplierReaders = slices.Concat(iam.ItemsPurchasing, iam.ItemsReports)
)
