# Fix PR Detail Not Found Issue

## Problem
Endpoint `/api/purchasing/pr/[id]` mengembalikan "PR tidak ditemukan" padahal data ada di database.

## Root Cause
Scope filtering di query detail menggunakan `.or()` yang tidak tepat untuk query dengan ID spesifik:
- Query: `eq("id", id).or("company_id.eq.xxx,branch_id.eq.yyy")`  
- Logika: (id match) AND (company_id match OR branch_id match)
- Jika PR tidak punya company_id/branch_id yang sesuai user scope, hasilnya tidak ditemukan

## Solution
Hapus scope filter di endpoint detail GET karena sudah ada permission check di `buildPRPermissions`. Endpoint PUT/DELETE tidak perlu scope filter karena sudah ada role-based access check.

## Files Changed
- `/src/app/api/purchasing/pr/[id]/route.ts` - Hapus scope filter di GET, hapus import scope yang tidak terpakai

## Implementation Steps
1. Hapus `scope`, `companyScopeOr`, `branchScopeOr` calls di GET handler
2. Hapus import scope functions
3. Pertahankan permission checking di `buildPRPermissions` untuk keamanan