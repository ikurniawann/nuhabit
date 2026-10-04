import type {
  PosProductStockAlert,
  ProductAtRiskAlert,
  RawMaterialAlert,
  StockAlertLevel,
} from "@/lib/pos/stock-alerts-types";

export type StockAlertTickerInput = {
  raw_materials: RawMaterialAlert[];
  products_at_risk: ProductAtRiskAlert[];
  pos_products: PosProductStockAlert[];
};

type TickerEntry = {
  level: StockAlertLevel;
  sourceOrder: number;
  text: string;
};

function posStatus(item: PosProductStockAlert): string {
  return item.current <= 0 ? "HABIS" : "MENIPIS";
}

function collectEntries(input: StockAlertTickerInput): TickerEntry[] {
  const entries: TickerEntry[] = [];

  for (const item of input.raw_materials) {
    entries.push({
      level: item.alert_level,
      sourceOrder: 0,
      text: `${item.nama} · ${item.status_stok}`,
    });
  }

  for (const item of input.products_at_risk) {
    entries.push({
      level: item.alert_level,
      sourceOrder: 1,
      text: `${item.nama} · ${item.max_servings} porsi`,
    });
  }

  for (const item of input.pos_products) {
    entries.push({
      level: item.alert_level,
      sourceOrder: 2,
      text: `${item.name} · ${posStatus(item)}`,
    });
  }

  return entries;
}

function levelRank(level: StockAlertLevel): number {
  return level === "critical" ? 0 : 1;
}

export function buildStockAlertTickerSegments(input: StockAlertTickerInput): string[] {
  return collectEntries(input)
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.sourceOrder - b.sourceOrder)
    .map((entry) => entry.text);
}

export function hasCriticalStockAlert(input: StockAlertTickerInput): boolean {
  return collectEntries(input).some((entry) => entry.level === "critical");
}
