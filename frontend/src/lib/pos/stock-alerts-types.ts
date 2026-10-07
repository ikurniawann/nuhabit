export type StockAlertLevel = "critical" | "warning";

export interface RawMaterialAlert {
  id: string;
  kode: string;
  nama: string;
  kategori: string;
  qty_onhand: number;
  min_stock: number;
  satuan: string;
  status_stok: "MENIPIS" | "HABIS" | string;
  alert_level: StockAlertLevel;
}

export interface ProductIngredientAlert {
  material_id: string;
  material_name: string;
  qty_available: number;
  required_per_unit: number;
  stock_coverage_units: number;
  alert_level: StockAlertLevel;
}

export interface ProductAtRiskAlert {
  product_id: string;
  kode: string;
  nama: string;
  max_servings: number;
  limiting_ingredient: string;
  ingredients: ProductIngredientAlert[];
  alert_level: StockAlertLevel;
}

export interface PosProductStockAlert {
  id: string;
  sku: string;
  name: string;
  current: number;
  min: number;
  alert_level: StockAlertLevel;
}

export interface StockAlertsSummary {
  raw_material_count: number;
  product_at_risk_count: number;
  pos_product_count: number;
}

export interface StockAlertsResponse {
  raw_materials: RawMaterialAlert[];
  products_at_risk: ProductAtRiskAlert[];
  pos_products: PosProductStockAlert[];
  summary: StockAlertsSummary;
  updated_at: string;
}
