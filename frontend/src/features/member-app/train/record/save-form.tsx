import { useEffect, useRef, useState } from "react";
import { gearKindFor } from "@/lib/gym/athlete";
import { GeoMap } from "../../components/geo-map";
import { ApiError } from "../../lib/api";
import { useT } from "../../lib/i18n";
import {
  trainApi,
  useUnits,
  type ActivityType,
  type ActivityVisibility,
  type TrackPoint,
} from "../../lib/queries-train";
import { formatDistanceM, formatDuration } from "../../ui";
import { VisibilityPicker } from "../visibility-picker";
import { defaultTitle, resizeImageToDataUrl } from "./helpers";
import { PhotoField } from "./photo-field";
import type { StrengthExercise } from "./strength";

export function SaveForm({
  type,
  strength,
  laps,
  points,
  elapsedSec,
  distanceM,
  startedAt,
  gear,
  onDiscard,
  onResume,
  onSaved,
}: {
  type: ActivityType;
  strength: StrengthExercise[];
  laps: number[];
  points: TrackPoint[];
  elapsedSec: number;
  distanceM: number;
  startedAt: number;
  gear: { id: string; name: string; kind: string }[];
  onDiscard: () => void;
  onResume: () => void;
  onSaved: (activityId: string) => void;
}) {
  const t = useT();
  const units = useUnits();
  const muscles = [...new Set(strength.map((ex) => ex.muscle))];
  const [title, setTitle] = useState(() =>
    type === "WORKOUT" && muscles.length > 0
      ? `${muscles.slice(0, 2).join(" & ")} Workout`
      : defaultTitle(type),
  );
  const [description, setDescription] = useState(() =>
    [
      ...strength
        .filter((ex) => ex.sets.some((set) => set.kg || set.reps || set.done))
        .map(
          (ex) =>
            `${ex.name}: ${ex.sets
              .filter((set) => set.kg || set.reps || set.done)
              .map((set) => `${set.kg || "-"}kg×${set.reps || "-"}`)
              .join(", ")}`,
        ),
      laps.length > 0
        ? `Laps: ${laps.map((at, i) => `${i + 1}) ${formatDuration(at - (laps[i - 1] ?? 0))}`).join("  ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const [gearId, setGearId] = useState("");
  const [visibility, setVisibility] = useState<ActivityVisibility>(type === "WORKOUT" ? "EVERYONE" : "PRIVATE");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveWithoutRoute, setSaveWithoutRoute] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const discardDialogRef = useRef<HTMLDivElement>(null);
  const routeMissing = type !== "WORKOUT" && points.length < 2;

  useEffect(() => {
    if (!confirmDiscard) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    discardDialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setConfirmDiscard(false); return; }
      if (event.key !== "Tab") return;
      const buttons = [...(discardDialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [confirmDiscard]);

  const addPhoto = async (file: File | undefined) => {
    if (!file || photos.length >= 2) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 640);
      setPhotos((p) => [...p, dataUrl]);
    } catch {
      setError(t("Could not read that image."));
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await trainApi.save({
        type,
        title,
        description,
        startedAt: new Date(startedAt).toISOString(),
        points: routeMissing ? [] : points,
        manualElapsedSec: type === "WORKOUT" || routeMissing ? Math.max(1, elapsedSec) : null,
        gearId: gearId || null,
        visibility,
        photos,
      });
      onSaved(saved.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Save failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="nh-card flex gap-6 text-sm">
        <div>
          <p className="nh-label !mb-0">{t("Time")}</p>
          <p className="nh-display text-xl">{formatDuration(elapsedSec)}</p>
        </div>
        {type !== "WORKOUT" ? (
          <div>
            <p className="nh-label !mb-0">{t("Distance")}</p>
            <p className="nh-display text-xl">
              {formatDistanceM(distanceM, units)}
            </p>
          </div>
        ) : null}
      </div>
      {points.length > 1 ? (
        <GeoMap tracks={[{ points }]} height={180} interactive={false} />
      ) : null}
      {routeMissing ? (
        <div className="nh-card space-y-3 text-sm">
          <p className="font-bold text-nh-warn">{t("GPS did not capture a usable route. You can keep the time and notes without a map.")}</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={saveWithoutRoute} onChange={(event) => setSaveWithoutRoute(event.target.checked)} className="mt-0.5 accent-nh-forest" />
            <span>{t("Save this activity without a GPS route")}</span>
          </label>
        </div>
      ) : null}
      <div>
        <label className="nh-label">{t("Title")}</label>
        <input
          className="nh-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="nh-label">{t("Description")}</label>
        <textarea
          className="nh-input min-h-20"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("How did it go?")}
        />
      </div>
      <PhotoField
        photos={photos}
        onAdd={(file) => void addPhoto(file)}
        onRemove={(i) => setPhotos((arr) => arr.filter((_, j) => j !== i))}
      />
      {gear.length > 0 && type !== "WORKOUT" ? (
        <div>
          <label className="nh-label">{t("Gear")}</label>
          <select
            className="nh-input"
            value={gearId}
            onChange={(e) => setGearId(e.target.value)}
          >
            <option value="">{t("None")}</option>
            {gear
              .filter((g) => g.kind === gearKindFor(type))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      <div>
        <label className="nh-label">{t("Who can see this")}</label>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
      </div>
      {error ? (
        <p className="text-sm font-bold text-nh-danger">{error}</p>
      ) : null}
      <button
        className="nh-btn-brand"
        disabled={busy || title.length < 1 || (routeMissing && !saveWithoutRoute)}
        onClick={() => void save()}
      >
        {t("Save activity")}
      </button>
      <button className="nh-btn-ghost" disabled={busy} onClick={onResume}>{t("Continue recording")}</button>
      <button className="nh-btn-ghost text-nh-danger" disabled={busy} onClick={() => setConfirmDiscard(true)}>
        {t("Discard")}
      </button>
      {confirmDiscard ? (
        <div ref={discardDialogRef} role="dialog" aria-modal="true" aria-labelledby="discard-activity-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5">
          <div className="nh-card w-full max-w-sm space-y-4">
            <h2 id="discard-activity-title" className="nh-display text-xl">{t("Discard this activity?")}</h2>
            <p className="text-sm text-nh-muted">{t("Your route and workout details will be lost.")}</p>
            <button className="nh-btn-brand w-full" onClick={() => setConfirmDiscard(false)}>{t("Keep activity")}</button>
            <button className="nh-btn-ghost w-full text-nh-danger" onClick={onDiscard}>{t("Discard activity")}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
