#!/usr/bin/env node
/**
 * Pindahkan halaman inline dari src/app/dashboard ke src/features
 * (pola: components/*-page.tsx + index.ts + thin route page).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/** @type {Array<{src:string, featureDir:string, componentFile:string, exportName:string, replaceExport?:RegExp, wrapper:(exportName:string)=>string}>} */
const MIGRATIONS = [
  {
    src: "src/app/dashboard/(dashboard)/page.tsx",
    featureDir: "src/features/hris/dashboard",
    componentFile: "recruitment-dashboard-page.tsx",
    exportName: "RecruitmentDashboardPage",
    replaceExport: /export default function DashboardPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/hris/dashboard";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/(dashboard)/employees/[id]/page.tsx",
    featureDir: "src/features/users",
    componentFile: "user-detail-page.tsx",
    exportName: "UserDetailPage",
    replaceExport: /export default function EmployeeProfilePage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/users";\n\nexport default function Page({ params }: { params: Promise<{ id: string }> }) {\n  return <${n} params={params} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/page.tsx",
    featureDir: "src/features/pos/dashboard",
    componentFile: "pos-dashboard-page.tsx",
    exportName: "PosDashboardPage",
    replaceExport: /export default function POSDashboard\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/dashboard";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/cashier-new/page.tsx",
    featureDir: "src/features/pos/cashier",
    componentFile: "cashier-page.tsx",
    exportName: "CashierPage",
    replaceExport: /export default function CashierPageNew\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/cashier";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/orders/page.tsx",
    featureDir: "src/features/pos/orders",
    componentFile: "orders-page.tsx",
    exportName: "OrdersPage",
    replaceExport: /export default function OrdersPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/orders";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/products/page.tsx",
    featureDir: "src/features/pos/products",
    componentFile: "products-page.tsx",
    exportName: "ProductsPage",
    replaceExport: /export default function ProductsPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/products";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/open-bills/page.tsx",
    featureDir: "src/features/pos/open-bills",
    componentFile: "open-bills-page.tsx",
    exportName: "OpenBillsPage",
    replaceExport: /export default function POSOpenBillsPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/open-bills";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/print-queue/page.tsx",
    featureDir: "src/features/pos/print-queue",
    componentFile: "print-queue-page.tsx",
    exportName: "PrintQueuePage",
    replaceExport: /export default function POSPrintQueuePage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/print-queue";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/reservation/page.tsx",
    featureDir: "src/features/pos/reservation",
    componentFile: "reservation-page.tsx",
    exportName: "ReservationPage",
    replaceExport: /export default function ReservationPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/reservation";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/topup/page.tsx",
    featureDir: "src/features/pos/topup",
    componentFile: "topup-page.tsx",
    exportName: "TopupPage",
    replaceExport: /export default function TopupPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/topup";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/recipe-builder/page.tsx",
    featureDir: "src/features/pos/recipe-builder",
    componentFile: "recipe-builder-page.tsx",
    exportName: "RecipeBuilderPage",
    replaceExport: /export default function RecipeBuilderPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/recipe-builder";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/reports/profit/page.tsx",
    featureDir: "src/features/pos/reports",
    componentFile: "profit-report-page.tsx",
    exportName: "ProfitReportPage",
    replaceExport: /export default function POSProfitReportPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/reports";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/printer-settings/page.tsx",
    featureDir: "src/features/pos/printer-settings",
    componentFile: "printer-settings-page.tsx",
    exportName: "PrinterSettingsPage",
    replaceExport: /export default function POSPrinterSettingsPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/printer-settings";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
  {
    src: "src/app/dashboard/pos/kds/page.tsx",
    featureDir: "src/features/pos/kds",
    componentFile: "kds-page.tsx",
    exportName: "KdsPage",
    replaceExport: /export default function KDSPage\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/kds";\n\nexport default function Page() {\n  return <${n} />;\n}\n`,
  },
];

const LAYOUT_MIGRATIONS = [
  {
    src: "src/app/dashboard/pos/layout.tsx",
    featureDir: "src/features/pos/layout",
    componentFile: "pos-layout.tsx",
    exportName: "PosLayout",
    replaceExport: /export default function POSLayout\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/pos/layout";\n\nexport default ${n};\n`,
  },
  {
    src: "src/app/dashboard/(dashboard)/purchasing/layout.tsx",
    featureDir: "src/features/purchasing/layout",
    componentFile: "purchasing-layout.tsx",
    exportName: "PurchasingLayout",
    replaceExport: /export default function PurchasingLayout\s*\(/,
    wrapper: (n) =>
      `import { ${n} } from "@/features/purchasing/layout";\n\nexport default ${n};\n`,
  },
];

function migrateOne(m) {
  const srcPath = path.join(ROOT, m.src);
  if (!fs.existsSync(srcPath)) {
    console.warn(`SKIP (missing): ${m.src}`);
    return;
  }
  const content = fs.readFileSync(srcPath, "utf-8");
  if (!m.replaceExport.test(content)) {
    console.warn(`SKIP (export pattern mismatch): ${m.src}`);
    return;
  }
  const componentDir = path.join(ROOT, m.featureDir, "components");
  fs.mkdirSync(componentDir, { recursive: true });
  const componentPath = path.join(componentDir, m.componentFile);
  const componentBody = content.replace(
    m.replaceExport,
    `export function ${m.exportName}(`
  );
  fs.writeFileSync(componentPath, componentBody, "utf-8");

  const indexPath = path.join(ROOT, m.featureDir, "index.ts");
  const exportLine = `export { ${m.exportName} } from "./components/${m.componentFile.replace(/\.tsx$/, "")}";\n`;
  if (fs.existsSync(indexPath)) {
    const idx = fs.readFileSync(indexPath, "utf-8");
    if (!idx.includes(m.exportName)) {
      fs.writeFileSync(indexPath, idx.trimEnd() + "\n" + exportLine, "utf-8");
    }
  } else {
    fs.writeFileSync(indexPath, exportLine, "utf-8");
  }

  fs.writeFileSync(srcPath, m.wrapper(m.exportName), "utf-8");
  console.log(`OK ${m.src} -> ${m.featureDir}/components/${m.componentFile}`);
}

for (const m of MIGRATIONS) migrateOne(m);
for (const m of LAYOUT_MIGRATIONS) migrateOne(m);
console.log("Done.");
