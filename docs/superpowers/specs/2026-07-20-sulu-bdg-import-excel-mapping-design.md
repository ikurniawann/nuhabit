# SULU Bandung → Import Excel Mapping

Date: 2026-07-20  
Source: `docs/data/SULU-bdg.xlsx`  
Output: `docs/data/sulu-import/`

## Goal

Map SULU Bandung food-testing workbook into Excel files aligned with dashboard import templates for raw materials and products, plus reference BOM sheets (no BOM import UI yet).

## Decisions (approved)

| Topic | Choice |
|---|---|
| Sub-recipe | Product `WIP` + Product BOM (not Raw Material BOM) |
| Raw material stall | `WH-01` (Main Storage) |
| FG / WIP stall | Match Excel station → `configuration.warehouses.name` → code |
| Shared WIP stall | Infer owner from usage; else first matched warehouse name |
| RM category | Heuristic map A from Marketlist group + item name |
| Product category | Heuristic map A from Draft Menu category |
| Kitchen Tools/Equipment | Excluded |
| Raw Material BOM file | Empty placeholder + note (not used) |

## Warehouse map (from DB)

| Code | Name |
|---|---|
| WH-01 | Main Storage |
| STALL-02 | Hikiniku Bar |
| STALL-03 | Noodles Bar |
| STALL-04 | Onigiri Corner |
| STALL-05 … STALL-11 | Yokocho 1 … 7 |
| STALL-14 | Yokocho 8 |
| STALL-12 | Yokocho 9 |
| STALL-13 | Yokocho 10 |

## Output files

1. `01-raw-materials.xlsx` — columns match `RAW_MATERIAL_IMPORT_COLUMNS`
2. `02-products.xlsx` — columns match `PRODUCT_IMPORT_COLUMNS` (FG + WIP)
3. `03-product-bom.xlsx` — reference BOM (name-based keys)
4. `04-raw-material-bom.xlsx` — empty + explanation sheet

## Source → target

| Source sheet | Target |
|---|---|
| Marketlist batch 1 + 2 | Raw materials (dedupe by normalized name) |
| Draft Menu | Products FINISHED_GOOD |
| SUB-RECIPE CARD | Products WIP + Product BOM lines |
| ITEM SALES RECIPE | Product BOM for FG (and ensure FG exists) |
| Kitchen Tools / Equipment / Comment Card | Skip |

## Defaults

- RM: `coa=PRODUCTION` (Kitchen Supplies → `ASSET`), `status=active`, opening stock from marketlist qty in small unit when conversion exists
- Recipe ingredients missing from marketlist: auto-added as RM (`deskripsi` marks source) after alias normalization to marketlist names
- FG: `satuan_kode=PORSI`, prices empty
- WIP: `kategori=OTHER`, `satuan_kode=PORSI`
- BOM: component names resolved via alias map → marketlist / WIP; sheet `unmapped` for leftovers

## Regenerating

```bash
python3 docs/data/generate_sulu_import_excels.py
```
