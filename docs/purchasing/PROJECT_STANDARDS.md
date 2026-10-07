# 📐 Project Standards & Best Practices

**Project:** Arkiv OS - Purchasing Module  
**Last Updated:** 2026-04-24  
**Status:** Active Standards

---

## 🎨 UI/UX DESIGN STANDARDS

### 1. Layout Pattern - FULL COLUMN (Default)

**ALL forms MUST use Full Column Layout** unless there's a specific reason for 2-column.

```tsx
// ✅ CORRECT - Full Column Layout
<div className="space-y-6">
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="text-base flex items-center gap-2">
        <Icon className="w-4 h-4" />
        Title
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      {/* Form fields */}
    </CardContent>
  </Card>
</div>
```

**Why Full Column?**
- ✅ Better mobile responsiveness
- ✅ Easier to scan vertically
- ✅ No empty white spaces
- ✅ Consistent across all pages
- ✅ Professional appearance

---

### 2. Component Sizes - COMPACT & PRECISE

**ALL inputs and components MUST follow these sizes:**

```tsx
// ✅ CORRECT - Compact sizes
<Input className="h-9 text-sm" />
<Combobox className="h-9 text-sm" />
<Label className="text-xs" />
<CardTitle className="text-base" />
<Icon className="w-4 h-4" />
```

**Spacing:**
```tsx
// ✅ CORRECT - Tight spacing
<div className="space-y-1.5">  {/* Between form fields */}
<div className="space-y-4">   {/* Inside CardContent */}
<div className="space-y-6">   {/* Between Cards */}
```

**DON'T use:**
```tsx
// ❌ WRONG - Too large
<Input className="h-10" />           // Too tall
<Label className="text-sm" />        // Too big
<Icon className="w-5 h-5" />         // Too large
<div className="space-y-2">          // Too loose
```

---

### 3. Dropdown Pattern - ALWAYS USE COMBOBOX

**ALL dropdowns MUST use searchable Combobox component:**

```tsx
// ✅ CORRECT - Combobox with search
import { Combobox } from "@/components/ui/combobox";

<Combobox
  options={options.map((o) => ({ value: o.value, label: o.label }))}
  value={formData.field}
  onChange={(v) => setFormData({ ...formData, field: v })}
  placeholder="Pilih..."
  searchPlaceholder="Cari..."
  emptyMessage="Tidak ditemukan"
  allowClear
  className="h-9 text-sm"
/>
```

**DON'T use Select:**
```tsx
// ❌ WRONG - No search, bad UX
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

<Select>
  <SelectTrigger>
    <SelectValue placeholder="Pilih..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="1">Option 1</SelectItem>
  </SelectContent>
</Select>
```

**Why Combobox?**
- ✅ Searchable (faster selection)
- ✅ Clear button (X to reset)
- ✅ Better UX for long lists
- ✅ Consistent pattern
- ✅ Mobile-friendly

---

### 4. Form Field Pattern

**Every form field MUST follow this structure:**

```tsx
<div className="space-y-1.5">
  <Label htmlFor="field" className="text-xs">
    Field Name {required && <span className="text-red-500">*</span>}
  </Label>
  <Input
    id="field"
    value={formData.field}
    onChange={(e) => setFormData({ ...formData, field: e.target.value })}
    placeholder="Short placeholder..."
    className="h-9 text-sm"
    required={required}
  />
  {/* Optional helper text */}
  <p className="text-xs text-gray-500">Helper text if needed</p>
</div>
```

**Placeholder Guidelines:**
- ✅ Short & clear: "Pilih kota..."
- ✅ Example if needed: "Contoh: PT Sari Laut"
- ✅ Action-oriented: "Cari..."
- ❌ Long & verbose: "Silahkan pilih kota dari daftar yang tersedia..."

---

### 5. Card Structure

**ALL cards MUST follow this structure:**

```tsx
<Card>
  <CardHeader className="pb-3">
    <CardTitle className="text-base flex items-center gap-2">
      <Icon className="w-4 h-4" />
      Card Title
    </CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Content */}
  </CardContent>
</Card>
```

**Card Grouping:**
- Group related fields together
- 1 card = 1 logical section
- Use icons for visual hierarchy
- Keep titles short (2-4 words)

---

### 6. Responsive Grid

**Use responsive grids for multi-column layouts:**

```tsx
// 2 columns on desktop
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {/* Fields */}
</div>

// 3 columns on desktop
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  {/* Fields */}
</div>
```

**Mobile-first:**
- Always 1 column on mobile (`grid-cols-1`)
- 2-3 columns on desktop (`md:grid-cols-2/3`)
- Test on both mobile and desktop

---

### 7. Action Buttons

**ALL forms MUST have consistent action buttons:**

```tsx
<div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t">
  <Button type="button" variant="outline" onClick={() => router.back()} className="px-6">
    Batal
  </Button>
  <Button type="submit" disabled={loading} className="px-6">
    <Save className="w-4 h-4 mr-2" />
    {loading ? "Menyimpan..." : "Simpan"}
  </Button>
</div>
```

**Button Pattern:**
- Always right-aligned
- "Batal" (outline) on left
- "Simpan" (primary) on right
- Loading state with spinner/text
- Icon on primary button

---

## 📁 FILE STRUCTURE STANDARDS

### New Page Template

```tsx
// src/app/(dashboard)/dashboard/purchasing/[module]/new/page.tsx

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { ArrowLeft, Save, [Icon] } from "lucide-react";
import { toast } from "sonner";
import { [Types] } from "@/types/purchasing";
import { [API] } from "@/lib/purchasing";

export default function New[Module]Page() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<[FormData]>({
    // Default values
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.required_field) {
      toast.error("Required field error");
      return;
    }

    setLoading(true);
    try {
      await [API](formData);
      toast.success("Success message");
      router.push("/dashboard/purchasing/[module]");
    } catch (error: any) {
      console.error("Error:", error);
      toast.error(error.message || "Error message");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/purchasing/[module]">
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Title</h1>
          <p className="text-sm text-gray-500">Subtitle</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Full Column Layout */}
        <div className="space-y-6">
          {/* Cards */}
        </div>

        {/* Action Buttons */}
      </form>
    </div>
  );
}
```

---

## ✅ CHECKLIST FOR NEW PAGES

Before marking a page as complete:

### Layout
- [ ] Full column layout (stacked cards)
- [ ] Compact components (h-9, text-sm)
- [ ] Tight spacing (space-y-1.5)
- [ ] Small icons (w-4 h-4)
- [ ] Responsive grid (md:grid-cols-2/3)

### Components
- [ ] All dropdowns use Combobox (NOT Select)
- [ ] All Combobox have search
- [ ] All Combobox have allowClear
- [ ] All Combobox have placeholder + searchPlaceholder
- [ ] All inputs have h-9 text-sm

### UX
- [ ] Short, clear placeholders
- [ ] Required fields marked with *
- [ ] Helper text only if needed
- [ ] Loading states on buttons
- [ ] Error handling with toast
- [ ] Success toast on save

### Code Quality
- [ ] TypeScript types defined
- [ ] Error handling with try-catch
- [ ] Console.error for debugging
- [ ] Clean imports (no unused)
- [ ] Consistent formatting

### Testing
- [ ] Test on desktop
- [ ] Test on mobile
- [ ] Test form validation
- [ ] Test success flow
- [ ] Test error flow
- [ ] Test all dropdowns searchable

---

## 🚀 QUICK START FOR NEW PROJECTS

### 1. Copy These Files

```bash
# Copy Combobox component
cp src/components/ui/combobox.tsx [new-project]/src/components/ui/

# Copy this standards doc
cp PROJECT_STANDARDS.md [new-project]/
```

### 2. Install Dependencies

```bash
npm install lucide-react sonner
# Already in arkiv-os: shadcn/ui components
```

### 3. Create First Page

Use the template above, customize for your needs.

### 4. Apply to All Pages

Consistency is key! Apply same patterns everywhere.

---

## 📚 REFERENCES

- **Combobox Component:** `src/components/ui/combobox.tsx`
- **Example Pages:**
  - `src/app/(dashboard)/dashboard/purchasing/suppliers/new/page.tsx`
  - `src/app/(dashboard)/dashboard/purchasing/products/new/page.tsx`
  - `src/app/(dashboard)/dashboard/purchasing/price-list/new/page.tsx`
- **Layout Documentation:** `LAYOUT_OPTIMIZATION_COMPLETE.md`

---

## 🎯 GOLDEN RULES

1. **Full Column Layout** - Always, unless there's a strong reason otherwise
2. **Combobox NOT Select** - All dropdowns must be searchable
3. **Compact Sizes** - h-9, text-sm, space-y-1.5
4. **Consistent Patterns** - Same structure everywhere
5. **Mobile-First** - Test on mobile, then desktop
6. **Clean Code** - Remove bloat, keep it simple
7. **Error Handling** - Always handle errors gracefully
8. **Loading States** - Show loading during async operations
9. **Toast Notifications** - Success and error messages
10. **Documentation** - Document decisions and patterns

---

**Remember:** Good design is invisible. Users shouldn't notice the UI, they should just get their work done efficiently. 🎨✨

---

**Created:** 2026-04-24  
**By:** OpenClaw Agent  
**Project:** Arkiv OS - Purchasing Module  
**Status:** Active Standards
