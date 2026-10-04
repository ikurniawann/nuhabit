import type {
  ProfitReportParams,
  RevenueCompositionReportParams,
  ClosingReportParams,
  TransactionReportParams,
  ProductSalesReportParams,
  RushHourReportParams,
  VoidReportParams,
  PaymentMethodsReportParams,
} from "@/lib/pos/reports/types";

export const reportsQueryKeys = {
  all: ["pos", "reports"] as const,
  profit: (params: ProfitReportParams) => ["pos", "reports", "profit", params] as const,
  revenueComposition: (params: RevenueCompositionReportParams) =>
    ["pos", "reports", "revenue-composition", params] as const,
  closing: (params: ClosingReportParams) => ["pos", "reports", "closing", params] as const,
  transactions: (params: TransactionReportParams) =>
    ["pos", "reports", "transactions", params] as const,
  productSales: (params: ProductSalesReportParams) =>
    ["pos", "reports", "product-sales", params] as const,
  rushHour: (params: RushHourReportParams) =>
    ["pos", "reports", "rush-hour", params] as const,
  voids: (params: VoidReportParams) => ["pos", "reports", "voids", params] as const,
  paymentMethods: (params: PaymentMethodsReportParams) =>
    ["pos", "reports", "payment-methods", params] as const,
};
