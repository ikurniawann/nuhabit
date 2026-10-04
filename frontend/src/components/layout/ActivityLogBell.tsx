"use client";

import { useState } from "react";
import { Bell, Trash2, CheckCheck, Package, Truck, Users, DollarSign, FileText, Archive, Lock, Unlock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { cn } from "@/lib/utils";

type PosShiftBellInfo = {
  isActive: boolean;
  loading?: boolean;
  shiftNumber?: string | null;
  totalOrders?: number;
  totalSales?: number;
  onClick: () => void;
  formatCurrency: (value: number) => string;
};

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  PO: FileText,
  GRN: Truck,
  SUPPLIER: Users,
  RAW_MATERIAL: Package,
  PRODUCT: Package,
  PRICE_LIST: DollarSign,
  DELIVERY: Truck,
  RETURN: Archive,
  INVENTORY: Archive,
};

const TYPE_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-700",
  UPDATE: "bg-blue-100 text-blue-700",
  DELETE: "bg-red-100 text-red-700",
  STATUS_CHANGE: "bg-orange-100 text-orange-700",
  APPROVE: "bg-purple-100 text-purple-700",
  REJECT: "bg-gray-100 text-gray-700",
};

export function ActivityLogBell({ posShift }: { posShift?: PosShiftBellInfo }) {
  const { logs, unreadCount, markAsRead, markAllAsRead, clearAll } = useActivityLog();
  const [open, setOpen] = useState(false);

  const handleLogClick = (logId: string) => {
    markAsRead(logId);
  };

  const handleClearAll = () => {
    clearAll();
    setOpen(false);
  };

  const handleMarkAllRead = () => {
    markAllAsRead();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label="Notifikasi"
        className="relative inline-flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-card transition-colors hover:bg-surface active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
      >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 border-surface bg-accent px-1 text-[10.5px] font-bold text-accent-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="z-[10000] w-[min(400px,calc(100vw-1.5rem))] max-h-[500px] p-0"
        sideOffset={8}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-4 pt-4 pb-3">
          <div>
            <h3 className="text-sm font-semibold">Activity Log</h3>
            <p className="text-xs text-muted-foreground">
              {unreadCount} unread {unreadCount === 1 ? "notification" : "notifications"}
            </p>
          </div>
          <div className="flex gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleMarkAllRead}
                title="Mark all as read"
              >
                <CheckCheck className="h-4 w-4" />
              </Button>
            )}
            {logs.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-red-500 hover:text-red-700"
                onClick={handleClearAll}
                title="Clear all"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {posShift && (
          <button
            type="button"
            onClick={() => {
              posShift.onClick();
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-gray-50",
              posShift.isActive ? "bg-green-50/60" : "bg-amber-50/60"
            )}
          >
            <div className={cn(
              "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full",
              posShift.isActive ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            )}>
              {posShift.isActive ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {posShift.loading ? "Memuat shift..." : posShift.isActive ? "Shift POS aktif" : "Shift POS belum dibuka"}
                </p>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                  posShift.isActive ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                )}>
                  {posShift.isActive ? "Aktif" : "Tutup"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {posShift.isActive
                  ? `${posShift.shiftNumber || "Shift"} · ${posShift.totalOrders || 0} order · ${posShift.formatCurrency(posShift.totalSales || 0)}`
                  : "Klik untuk membuka shift kasir."}
              </p>
            </div>
          </button>
        )}

        {/* Logs List */}
        <div className="max-h-[400px] overflow-y-auto bg-white">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-12 w-12 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No activity yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your recent actions will appear here
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {logs.map((log) => {
                const IconComponent = MODULE_ICONS[log.module] || Package;
                const timeAgo = formatDistanceToNow(new Date(log.timestamp), {
                  addSuffix: true,
                  locale: id,
                });

                return (
                  <div
                    key={log.id}
                    className={cn(
                      "p-3 hover:bg-muted/50 cursor-pointer transition-colors",
                      !log.isRead && "bg-muted/30"
                    )}
                    onClick={() => handleLogClick(log.id)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div
                        className={cn(
                          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                          TYPE_COLORS[log.type]
                        )}
                      >
                        <IconComponent className="w-4 h-4" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium truncate">{log.title}</p>
                          {!log.isRead && (
                            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {log.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{timeAgo}</p>
                        {log.recordNumber && (
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {log.recordNumber}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
