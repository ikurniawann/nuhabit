"use client";

import { useT } from "../lib/i18n";
import type { ActivityVisibility } from "../lib/queries-train";

/** EVERYONE / FOLLOWERS / PRIVATE pills (save form and edit sheet). */
export function VisibilityPicker({
  value,
  onChange,
}: {
  value: ActivityVisibility;
  onChange: (next: ActivityVisibility) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["EVERYONE", "FOLLOWERS", "PRIVATE"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-xl border px-2 py-2 text-xs font-black uppercase ${
            value === v
              ? "border-nh-forest bg-nh-forest/10 text-nh-forest"
              : "border-nh-line bg-nh-cream text-nh-muted"
          }`}
        >
          {t(v.toLowerCase())}
        </button>
      ))}
    </div>
  );
}
