#!/bin/bash
# Batch update: Replace Select with Combobox in Purchasing forms

FILES=(
  "src/app/(dashboard)/dashboard/purchasing/raw-materials/[id]/edit/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/products/new/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/products/[id]/edit/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/po/new/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/suppliers/new/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/suppliers/[id]/edit/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/price-list/new/page.tsx"
  "src/app/(dashboard)/dashboard/purchasing/price-list/[id]/edit/page.tsx"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing: $file"
    
    # Add Combobox import if not exists
    if ! grep -q "import.*Combobox" "$file"; then
      sed -i '' 's|import { toast } from "sonner";|import { toast } from "sonner";\nimport { Combobox } from "@/components/ui/combobox";|g' "$file"
    fi
    
    echo "  ✓ Added Combobox import"
  else
    echo "  ✗ File not found: $file"
  fi
done

echo "Done!"
