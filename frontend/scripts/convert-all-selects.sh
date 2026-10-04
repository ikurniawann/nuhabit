#!/bin/bash
# MASS DROPDOWN CONVERSION SCRIPT
# Converts all <Select> to <Combobox> in purchasing module

echo "🚀 Starting Mass Dropdown Conversion..."
echo "========================================"
echo ""

# Files to process (excluding complex ones)
FILES=(
  "src/app/(dashboard)/dashboard/purchasing/grn/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/returns/new/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/returns/page.tsx"
  "src/app/(dashboard)/dashboard/inventory/page.tsx"
  "src/app/(dashboard)/dashboard/inventory/low-stock/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/reports/po-summary/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/reports/inventory-valuation/page.tsx"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "📄 Processing: $file"
    
    # Add Combobox import if not exists
    if ! grep -q "import.*Combobox" "$file"; then
      sed -i '' 's|import { toast } from "sonner";|import { toast } from "sonner";\nimport { Combobox } from "@/components/ui/combobox";|g' "$file"
      echo "   ✓ Added Combobox import"
    fi
    
    # Count Selects
    select_count=$(grep -c "<Select" "$file" || echo "0")
    echo "   📊 Found $select_count dropdowns to convert"
  else
    echo "   ⚠️  File not found"
  fi
done

echo ""
echo "✅ Import phase complete!"
echo "Next: Manual conversion of Select components needed"
