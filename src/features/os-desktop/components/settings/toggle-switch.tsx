"use client";

export function ToggleSwitch({ enabled, onChange, label }: { enabled: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative h-7 w-12 rounded-full border transition ${enabled ? "border-pink-200/50 bg-pink-500" : "border-white/15 bg-white/10"}`}
      aria-label={label}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition ${enabled ? "left-6" : "left-1"}`} />
    </button>
  );
}
