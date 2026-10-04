"use client";

import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableRow } from "@/components/ui/table";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";
import type { FlatCoaTreeRow } from "@/lib/accounting/coa-tree";
import type { CoaAccountItem } from "../types";

export function CoaTreeTable({
  flatRows,
  expandedIds,
  toggleExpand,
  openAdd,
  openEdit,
  onDelete,
}: {
  flatRows: FlatCoaTreeRow<CoaAccountItem>[];
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  openAdd: (parent: CoaAccountItem) => void;
  openEdit: (item: CoaAccountItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto px-4">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-3">Kode / Nama</th>
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Cash Flow</th>
            <th className="px-3 py-3">Flags</th>
            <th className="px-3 py-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {flatRows.map(({ item, depth, hasChildren }) => (
            <TableRow
              key={item.id}
              className="border-b border-gray-200/70 hover:bg-muted/40"
            >
              <td className="px-3 py-2.5">
                <div
                  className="flex items-center gap-1"
                  style={{ paddingLeft: depth * 16 }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                      aria-label="Toggle"
                    >
                      {expandedIds.has(item.id) ? (
                        <ChevronDownIcon className="h-4 w-4" />
                      ) : (
                        <ChevronRightIcon className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <span className="inline-block w-5" />
                  )}
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.code_display || formatAccountCodeDisplay(item.code)}
                    </div>
                    <div
                      className={
                        item.is_postable
                          ? "font-medium text-foreground"
                          : "font-semibold text-foreground"
                      }
                    >
                      {item.name}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <Badge variant="outline" className="border-gray-200/80">
                  {item.account_type_code || "—"}
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {item.cash_flow_category || "—"}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  <Badge
                    variant="outline"
                    className={
                      item.is_postable
                        ? "border-emerald-200/80 text-emerald-700"
                        : "border-gray-200/80 text-muted-foreground"
                    }
                  >
                    {item.is_postable ? "Postable" : "Header"}
                  </Badge>
                  {item.is_contra ? (
                    <Badge
                      variant="outline"
                      className="border-amber-200/80 text-amber-700"
                    >
                      Contra
                    </Badge>
                  ) : null}
                  {item.is_cash_bank ? (
                    <Badge
                      variant="outline"
                      className="border-sky-200/80 text-sky-700"
                    >
                      Kas/Bank
                    </Badge>
                  ) : null}
                  {!item.is_active ? (
                    <Badge
                      variant="outline"
                      className="border-gray-200/80 text-muted-foreground"
                    >
                      Nonaktif
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-brand-text"
                    onClick={() => openAdd(item)}
                  >
                    + Child
                  </Button>
                  <MasterTableActions
                    onEdit={() => openEdit(item)}
                    onDelete={() => onDelete(item.id)}
                  />
                </div>
              </td>
            </TableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
