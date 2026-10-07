import type {
  InventoryValuationParams,
  PODetailParams,
  POSummaryParams,
  ProductionInHouseParams,
  StockCardParams,
} from "./types";

export const reportsQueryKeys = {
  all: ["purchasing", "reports"] as const,
  supplierPerformance: (params: {
    date_from?: string;
    date_to?: string;
    supplier_id?: string;
  }) => ["purchasing", "reports", "supplier-performance", params] as const,
  poSummary: (params: POSummaryParams) =>
    ["purchasing", "reports", "po-summary", params] as const,
  stockCard: (params: StockCardParams) =>
    ["purchasing", "reports", "stock-card", params] as const,
  inventoryValuation: (params: InventoryValuationParams) =>
    ["purchasing", "reports", "inventory-valuation", params] as const,
  poDetail: (params: PODetailParams) =>
    ["purchasing", "reports", "po-detail", params] as const,
  warehouses: ["purchasing", "reports", "warehouses"] as const,
  productionInHouse: (params: ProductionInHouseParams) =>
    ["purchasing", "reports", "production-in-house", params] as const,
};
