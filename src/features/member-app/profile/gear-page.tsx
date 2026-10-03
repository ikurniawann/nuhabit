"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bike,
  Check,
  Footprints,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import {
  trainApi,
  useAthleteStats,
  useInvalidateAll,
  useUnits,
  type GearView,
} from "../lib/queries-train";
import { Spinner, formatDistanceM } from "../ui";

export function GearPage() {
  const router = useRouter();
  const t = useT();
  const units = useUnits();
  const invalidate = useInvalidateAll();
  const { data: stats, isLoading, error: loadError } = useAthleteStats();
  const [addOpen, setAddOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState("");

  if (loadError)
    return (
      <p className="nh-card text-sm text-nh-danger">{loadError.message}</p>
    );
  if (isLoading || !stats) return <Spinner label={t("Loading gear…")} />;
  const gear = stats.gear;
  const active = gear.filter((g) => !g.retired);
  const retired = gear.filter((g) => g.retired);

  const update = async (
    g: GearView,
    patch: Partial<Pick<GearView, "name" | "retired">>,
    failMessage: string,
  ) => {
    setError("");
    try {
      await trainApi.updateGear(g.id, {
        name: g.name,
        kind: g.kind,
        retired: g.retired,
        ...patch,
      });
      if (patch.name !== undefined) setRenamingId(null);
      invalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t(failMessage));
    }
  };

  const renderRow = (g: GearView) => (
    <div
      key={g.id}
      className={`nh-card flex items-center gap-3 !py-4 ${g.retired ? "opacity-60" : ""}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-nh-ink-soft text-white">
        {g.kind === "SHOES" ? <Footprints size={19} /> : <Bike size={19} />}
      </span>
      <div className="min-w-0 flex-1">
        {renamingId === g.id ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="nh-input !py-1.5 text-sm"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim().length >= 2)
                  void update(g, { name: renameValue }, "Rename failed.");
                if (e.key === "Escape") setRenamingId(null);
              }}
            />
            <button
              className="text-nh-ok"
              aria-label={t("Save name")}
              onClick={() =>
                void update(g, { name: renameValue }, "Rename failed.")
              }
              disabled={renameValue.trim().length < 2}
            >
              <Check size={18} />
            </button>
            <button
              className="text-nh-muted"
              aria-label={t("Cancel")}
              onClick={() => setRenamingId(null)}
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <>
            <p className="flex items-center gap-1.5 truncate text-sm font-extrabold">
              {g.name}
              <button
                className="text-nh-muted"
                aria-label={t("Rename")}
                onClick={() => {
                  setRenamingId(g.id);
                  setRenameValue(g.name);
                }}
              >
                <Pencil size={13} />
              </button>
            </p>
            <p className="text-xs text-nh-muted">
              {t(g.kind === "SHOES" ? "Shoes" : "Bike")} ·{" "}
              {formatDistanceM(g.distanceM, units)} {t("logged")}
            </p>
          </>
        )}
      </div>
      <button
        className={`nh-chip shrink-0 ${g.retired ? "bg-nh-ok/10 text-nh-ok" : "bg-nh-raised text-nh-muted"}`}
        onClick={() =>
          void update(g, { retired: !g.retired }, "Update failed.")
        }
      >
        {t(g.retired ? "Reactivate" : "Retire")}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm font-bold text-nh-muted"
      >
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="nh-display text-3xl">{t("My gear")}</h1>
          <p className="mt-1 text-sm text-nh-muted">
            {t("Mileage adds up automatically from your activities.")}
          </p>
        </div>
        <button
          className="nh-btn-brand mt-1 flex shrink-0 items-center gap-1.5 !px-4 !py-2.5 text-sm"
          onClick={() => setAddOpen(true)}
        >
          <Plus size={16} /> {t("Add")}
        </button>
      </div>

      {error ? (
        <p className="text-sm font-bold text-nh-danger">{error}</p>
      ) : null}

      {gear.length === 0 ? (
        <div className="nh-card text-sm text-nh-muted">
          {t(
            "Nothing here yet - add your shoes or bike and every run and ride keeps its mileage up to date.",
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">{active.map(renderRow)}</div>
          {retired.length > 0 ? (
            <div>
              <p className="mb-2 px-1 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
                {t("Retired")}
              </p>
              <div className="flex flex-col gap-2">
                {retired.map(renderRow)}
              </div>
            </div>
          ) : null}
        </>
      )}

      {addOpen ? (
        <AddGearSheet
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

/** Bottom sheet to add shoes or a bike (gear page and the You tab). */
export function AddGearSheet({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"SHOES" | "BIKE">("SHOES");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await trainApi.createGear({ name, kind, retired: false });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Save failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="nh-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="nh-sheet-panel w-full max-w-md rounded-t-3xl bg-nh-cream p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="nh-display mb-4 text-xl">{t("Add gear")}</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="nh-label">{t("Name")}</label>
            <input
              className="nh-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Novablast 4"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["SHOES", "BIKE"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-black uppercase ${
                  kind === k
                    ? "border-nh-forest bg-nh-forest/10 text-nh-forest"
                    : "border-nh-line bg-nh-cream text-nh-muted"
                }`}
              >
                {t(k === "SHOES" ? "Shoes" : "Bike")}
              </button>
            ))}
          </div>
          {error ? (
            <p className="text-sm font-bold text-nh-danger">{error}</p>
          ) : null}
          <button
            className="nh-btn-brand"
            disabled={busy || name.trim().length < 2}
            onClick={() => void save()}
          >
            {t("Add gear")}
          </button>
        </div>
      </div>
    </div>
  );
}
