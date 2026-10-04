"use client";

import { WEEKDAY_SHORT, buildMonthCells } from "../../lib/format";
import { WindowShell } from "../windows/window-shell";

export function CalendarWidget({ date, onClose }: { date: Date; onClose: () => void }) {
  const today = date.getDate();
  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);

  return (
    <WindowShell title="Calendar Widget" onClose={onClose} className="right-5 top-16 hidden w-80 lg:block">
      <div className="p-5">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight capitalize">{monthLabel}</h2>
            <p className="text-xs text-white/55">Monthly view</p>
          </div>
          <div className="rounded-2xl bg-pink-500/25 px-3 py-2 text-center">
            <div className="text-2xl font-bold leading-none">{today}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-pink-100">Today</div>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_SHORT.map((day) => (
            <div key={day} className="py-1 text-[11px] font-semibold text-white/45">
              {day}
            </div>
          ))}
          {buildMonthCells(date).map((cell, index) => (
            <div
              key={`${cell ?? "blank"}-${index}`}
              className={`grid aspect-square place-items-center rounded-xl text-sm ${
                cell ? (cell === today ? "bg-accent font-bold text-accent-foreground shadow-lg" : "bg-black/14 text-white/78") : ""
              }`}
            >
              {cell}
            </div>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}
