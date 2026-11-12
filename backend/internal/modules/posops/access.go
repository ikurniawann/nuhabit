package posops

import (
	"slices"

	"nuhabit/backend/internal/platform/iam"
)

// Menu sets: each route accepts the leaf menus whose pages call it.
var (
	// menusProducts: cashier catalog, Products page, CRM Settings (product XP).
	menusProducts = slices.Concat(iam.PosCashier, iam.PosCatalogProducts, iam.CrmSettingsConfig)
	// menusCustomers: member search on the cashier, Top-up and Reservation pages.
	menusCustomers = slices.Concat(iam.PosCashier, iam.PosTopup, iam.PosReservation)
	// menusTableBoard: table pickers on the cashier and Reservation pages.
	menusTableBoard   = slices.Concat(iam.PosCashier, iam.PosReservation, iam.PosTables)
	menusReservations = slices.Concat(iam.PosCashier, iam.PosReservation)
	// menusCurrentShift: the cashier and the member bill payment dialog.
	menusCurrentShift = slices.Concat(iam.PosCashier, iam.PosMemberBills)
	// menusReceipt: pages that print a receipt (cashier, Orders, gym desk).
	menusReceipt = slices.Concat(iam.PosCashier, iam.PosOrders, iam.GymCredits)
	// menusLoyaltyRead: the ARK rate on receipts, top-up, transaction detail
	// and the ARK & XP page.
	menusLoyaltyRead = slices.Concat(menusReceipt, iam.PosTopup, iam.PosLoyaltySettings,
		iam.PosReportTransactions, iam.PosReportVoids)
	menusPaymentMethods = slices.Concat(iam.PosCashier, iam.PosMemberBills, iam.PosPaymentMethods)
	menusBilling        = slices.Concat(iam.PosCashier, iam.SettingsBilling)
	// menusReportExport: any report page; the report key then needs its own
	// pos.reports.<key> menu.
	menusReportExport = slices.Concat(iam.PosReportProfit, iam.PosReportRevenueComposition,
		iam.PosReportTransactions, iam.PosReportRushHour, iam.PosReportProductSales,
		iam.PosReportVoids, iam.PosReportPaymentMethods)
)
