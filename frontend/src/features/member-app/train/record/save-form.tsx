import { useState } from "react";
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
  const [visibility, setVisibility] = useState<ActivityVisibility>("EVERYONE");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
        points,
        manualElapsedSec: type === "WORKOUT" ? Math.max(1, elapsedSec) : null,
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
      {type !== "WORKOUT" && points.length === 0 ? (
        <p className="text-sm text-nh-danger">{t("No GPS route was recorded. Discard this activity and try again outdoors.")}</p>
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
        disabled={busy || title.length < 1 || (type !== "WORKOUT" && points.length === 0)}
        onClick={() => void save()}
      >
        {t("Save activity")}
      </button>
      <button className="nh-btn-ghost text-nh-danger" onClick={onDiscard}>
        {t("Discard")}
      </button>
    </div>
  );
}
