"use client";

import { AlertCircle, ArrowLeft, Monitor as MonitorIcon, ShoppingBag, Table as TableIcon, Users, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PosTabletChromeControls } from "@/features/pos/components/pos-tablet-chrome-controls";
import { StallSwitchButton } from "./stall-switch-button";

const OUTLINE_BUTTON =
  "border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-brand-text";

interface CashierHeaderProps {
  isTabletMode: boolean;
  orderType: string;
  tableLabel: string | null;
  guestCount: number;
  capacityWarning: string | null;
  fromRestaurant: boolean;
  showSecondaryDisplays: boolean;
  ordersHref: string;
  onEditGuests: () => void;
  onBackToRestaurant: () => void;
  onToggleImmersive: (next: boolean) => void;
}

function OrderSummary(props: CashierHeaderProps) {
  const { orderType, tableLabel } = props;
  if (props.isTabletMode) {
    return (
      <p className="truncate text-xs text-muted-foreground">
        {tableLabel ? `Meja ${tableLabel}` : orderType === "takeaway" ? "Take Away" : "Dine-in"}
        {tableLabel || orderType === "dine_in" ? ` · ${props.guestCount} tamu` : null}
      </p>
    );
  }
  if (orderType !== "dine_in" && orderType !== "takeaway" && !tableLabel) {
    return <p className="text-sm text-gray-500">Process orders with the dashboard sidebar available</p>;
  }
  return (
    <p className="text-sm text-gray-500">
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {tableLabel ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-brand-text">
            <TableIcon className="h-3.5 w-3.5" />
            Table {tableLabel}
          </span>
        ) : orderType === "takeaway" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
            <ShoppingBag className="h-3.5 w-3.5" />
            Take Away
          </span>
        ) : orderType === "dine_in" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-brand-text">
            <Utensils className="h-3.5 w-3.5" />
            Dine-in
          </span>
        ) : null}
        {tableLabel || orderType === "dine_in" ? (
          <>
            {tableLabel ? (
              <>
                <span className="text-gray-300">·</span>
                <span>Dine-in</span>
              </>
            ) : null}
            <span className="text-gray-300">·</span>
            {/* Jumlah tamu (EPIC-038): tombol → dialog supaya angkanya terbaca jelas. */}
            <button
              type="button"
              onClick={props.onEditGuests}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:border-primary hover:text-brand-text"
            >
              <Users className="h-3.5 w-3.5" />
              {props.guestCount} tamu
            </button>
            {/* Peringatan, BUKAN blokir (keputusan owner). */}
            {props.capacityWarning && (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <AlertCircle className="h-3.5 w-3.5" />
                {props.capacityWarning}
              </span>
            )}
          </>
        ) : null}
        {props.fromRestaurant ? (
          <>
            <span className="text-gray-300">·</span>
            <span>From restaurant</span>
          </>
        ) : null}
      </span>
    </p>
  );
}

export function CashierHeader(props: CashierHeaderProps) {
  const { isTabletMode } = props;
  return (
    <div className={`flex shrink-0 flex-wrap items-center justify-between ${isTabletMode ? "gap-2" : "gap-3"}`}>
      <div className="min-w-0">
        <h1 className={`font-semibold text-gray-900 ${isTabletMode ? "text-base" : "text-xl"}`}>
          POS Cashier
        </h1>
        <OrderSummary {...props} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StallSwitchButton />
        {props.fromRestaurant && (
          <Button type="button" variant="outline" className={OUTLINE_BUTTON} onClick={props.onBackToRestaurant}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Restaurant
          </Button>
        )}
        {props.showSecondaryDisplays ? (
          <div className="hidden [@media(hover:hover)_and_(pointer:fine)]:contents">
            {/* EPIC-024: layar customer & TV antrian di window baru, drag ke monitor kedua lalu F11. */}
            <Button
              type="button"
              variant="outline"
              title="Buka layar customer di window baru — drag ke monitor kedua, lalu F11"
              className={OUTLINE_BUTTON}
              onClick={() =>
                window.open("/pos/customer-display", "pos-customer-display", "popup=yes,width=1024,height=640")
              }
            >
              <MonitorIcon className="mr-2 h-4 w-4" />
              Layar Customer
            </Button>
            <Button
              type="button"
              variant="outline"
              title="Buka TV antrian customer — drag ke TV/monitor tamu, lalu F11"
              className={OUTLINE_BUTTON}
              onClick={() => window.open("/pos/queue", "pos-queue-board", "popup=yes,width=1440,height=900")}
            >
              <MonitorIcon className="mr-2 h-4 w-4" />
              TV Antrian
            </Button>
          </div>
        ) : null}
        <PosTabletChromeControls
          immersive={isTabletMode}
          ordersHref={props.ordersHref}
          onToggleImmersive={props.onToggleImmersive}
        />
      </div>
    </div>
  );
}
