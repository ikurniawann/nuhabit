#!/usr/bin/env python3
"""
Batch migrate all Select components to Combobox in Purchasing module
"""

import os
import re

BASE_DIR = "src/app/(dashboard)/dashboard/purchasing"

# Files to process with their dropdown field mappings
FILES_TO_PROCESS = [
    # Raw Materials
    ("raw-materials/[id]/edit/page.tsx", ["kategori", "satuan_besar", "satuan_kecil", "storage_condition"]),
    
    # Products
    ("products/new/page.tsx", []),  # Already has import, no Selects
    ("products/[id]/edit/page.tsx", ["kategori", "satuan"]),
    
    # Purchase Orders
    ("po/new/page.tsx", ["supplier", "material"]),  # Complex - multiple rows
    
    # Suppliers
    ("suppliers/new/page.tsx", ["payment_terms", "currency", "kota"]),
    ("suppliers/[id]/edit/page.tsx", ["payment_terms", "currency", "kota"]),
    
    # Price Lists
    ("price-list/new/page.tsx", ["supplier", "bahan_baku", "satuan"]),
    ("price-list/[id]/edit/page.tsx", ["supplier", "bahan_baku", "satuan"]),
]

def add_combobox_import(content):
    """Add Combobox import if not exists"""
    if 'import { Combobox }' in content:
        return content, False
    
    # Find toast import and add after it
    pattern = r'(import { toast } from "sonner";)'
    replacement = r'\1\nimport { Combobox } from "@/components/ui/combobox";'
    
    new_content = re.sub(pattern, replacement, content)
    return new_content, True

def convert_simple_select(content, field_name):
    """Convert simple Select to Combobox"""
    # Pattern for basic Select component
    patterns = [
        # Pattern 1: Select with value and onValueChange
        (
            rf'<Select\s+value=\{{formData\.{field_name}[^\}]*\}}\s+onValueChange=\{{\([^)]+\)\s*=>\s*setFormData\(\{{\s*\.\.\.formData,\s*{field_name}:\s*([^\)]+)\s*\}}\)\}}[^>]*>.*?</Select>',
            f'<Combobox options={{OPTIONS}} value={{formData.{field_name}}} onChange={{(v) => setFormData({{ ...formData, {field_name}: v }})}} placeholder="Pilih {field_name}..." allowClear />'
        ),
    ]
    
    return content

def process_file(filepath, fields):
    """Process a single file"""
    if not os.path.exists(filepath):
        print(f"  ⚠️  File not found: {filepath}")
        return False
    
    with open(filepath, 'r') as f:
        original_content = f.read()
    
    content = original_content
    
    # Step 1: Add Combobox import
    content, import_added = add_combobox_import(content)
    if import_added:
        print(f"  ✓ Added Combobox import")
    
    # TODO: Step 2: Convert Selects to Combobox (complex - need manual review)
    # For now, we'll just add the import and do manual conversion
    
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    
    return False

def main():
    print("🚀 Starting Combobox Migration...\n")
    
    success_count = 0
    skip_count = 0
    
    for filepath_rel, fields in FILES_TO_PROCESS:
        filepath = os.path.join(BASE_DIR, filepath_rel)
        print(f"Processing: {filepath_rel}")
        
        try:
            if process_file(filepath, fields):
                success_count += 1
                print(f"  ✅ Updated\n")
            else:
                skip_count += 1
                print(f"  ⏭️  Skipped (no changes needed)\n")
        except Exception as e:
            print(f"  ❌ Error: {e}\n")
            skip_count += 1
    
    print(f"\n{'='*60}")
    print(f"Migration Complete!")
    print(f"✅ Updated: {success_count} files")
    print(f"⏭️  Skipped: {skip_count} files")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
