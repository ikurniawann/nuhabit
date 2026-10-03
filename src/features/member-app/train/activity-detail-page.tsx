"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Award,
  MessageCircle,
  MoreHorizontal,
  ThumbsUp,
  Users,
} from "lucide-react";
import { GeoMap } from "../components/geo-map";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import {
  trainApi,
  useActivity,
  useInvalidateAll,
  useKudosMutation,
  useUnits,
  type ActivityVisibility,
} from "../lib/queries-train";
import {
  Spinner,
  formatDayTime,
  formatDistanceM,
  formatDuration,
  formatPace,
  formatSpeedKmh,
} from "../ui";
import { typeLabel } from "./feed-page";
import { VisibilityPicker } from "./visibility-picker";

export function ActivityDetailPage() {
  const { activityId = "" } = useParams<{ activityId: string }>();
  const router = useRouter();
  const t = useT();
  const units = useUnits();
  const { data: a, isLoading, error } = useActivity(activityId);
  const kudos = useKudosMutation();
  const invalidate = useInvalidateAll();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notice, setNotice] = useState("");

  if (error)
    return <p className="nh-card text-sm text-nh-muted">{error.message}</p>;
  if (isLoading || !a) return <Spinner label={t("Loading activity…")} />;

  const sendComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await trainApi.comment(a.id, comment.trim());
      setComment("");
      invalidate();
    } finally {
      setBusy(false);
    }
  };

  const saveAsRoute = async () => {
    const name = window.prompt(t("Route name?"), `${a.title} route`);
    if (!name) return;
    try {
      await trainApi.saveRoute(a.id, name);
      setNotice(`${t("Route saved - find it in Explore › Routes.")} (${name})`);
      invalidate();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : t("Could not save route."));
    }
    setMenuOpen(false);
  };

  const deleteActivity = async () => {
    if (!window.confirm(t("Delete this activity? This cannot be undone.")))
      return;
    await trainApi.deleteActivity(a.id);
    invalidate();
    router.replace(m("/train/you"));
  };

  const maxSplitPace = Math.max(...a.splits.map((s) => s.paceSecPerKm), 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm font-bold text-nh-muted"
        >
          <ArrowLeft size={16} /> {t("Back")}
        </button>
        {a.isOwn ? (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="rounded-full border border-nh-line bg-nh-cream p-2"
              aria-label={t("Activity menu")}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen ? (
              <div className="absolute top-10 right-0 z-20 w-44 rounded-xl border border-nh-line bg-nh-cream p-1 shadow-lg">
                <button
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-nh-raised"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditOpen(true);
                  }}
                >
                  {t("Edit activity")}
                </button>
                {a.points.length > 1 ? (
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-nh-raised"
                    onClick={() => void saveAsRoute()}
                  >
                    {t("Save as route")}
                  </button>
                ) : null}
                <button
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-nh-danger hover:bg-nh-raised"
                  onClick={() => void deleteActivity()}
                >
                  {t("Delete")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div>
        <p className="text-xs font-bold tracking-wider text-nh-muted uppercase">
          {a.memberName} · {formatDayTime(a.startedAt)} · {t(typeLabel(a.type))}
          {a.visibility !== "EVERYONE"
            ? ` · ${t(a.visibility.toLowerCase())}`
            : ""}
        </p>
        <h1 className="nh-display text-3xl">{a.title}</h1>
        {a.description ? (
          <p className="mt-1 text-sm whitespace-pre-line text-nh-muted">
            {a.description}
          </p>
        ) : null}
      </div>

      {notice ? (
        <p className="rounded-xl bg-nh-ok/10 px-3 py-2 text-sm font-bold text-nh-ok">
          {notice}
        </p>
      ) : null}

      {a.points.length > 1 ? (
        <GeoMap tracks={[{ points: a.points }]} height={240} />
      ) : null}

      {a.photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {a.photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={p}
              alt=""
              className="h-40 w-full rounded-xl object-cover"
            />
          ))}
        </div>
      ) : null}

      <div className="nh-card grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="nh-label !mb-0">{t("Distance")}</p>
          <p className="nh-display text-2xl">
            {a.type === "WORKOUT" ? "-" : formatDistanceM(a.distanceM, units)}
          </p>
        </div>
        <div>
          <p className="nh-label !mb-0">{t("Moving time")}</p>
          <p className="nh-display text-2xl">{formatDuration(a.movingSec)}</p>
        </div>
        <div>
          <p className="nh-label !mb-0">
            {t(a.type === "RIDE" ? "Avg speed" : "Avg pace")}
          </p>
          <p className="nh-display text-2xl">
            {a.type === "RIDE"
              ? formatSpeedKmh(a.distanceM, a.movingSec, units)
              : formatPace(a.avgPaceSecPerKm, units)}
          </p>
        </div>
        <div>
          <p className="nh-label !mb-0">{t("Elapsed")}</p>
          <p className="font-bold">{formatDuration(a.elapsedSec)}</p>
        </div>
        <div>
          <p className="nh-label !mb-0">{t("Elev gain")}</p>
          <p className="font-bold">
            {a.elevationGainM > 0 ? `${a.elevationGainM} m` : "-"}
          </p>
        </div>
        <div>
          <p className="nh-label !mb-0">{t("Gear")}</p>
          <p className="truncate font-bold">{a.gearName ?? "-"}</p>
        </div>
      </div>

      {a.groupedWith.length > 0 ? (
        <div className="nh-card !py-3">
          <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm font-bold">
            <Users size={16} className="mr-1 text-nh-forest" />
            {t("Trained together with")}{" "}
            {a.groupedWith.map((g, i) => (
              <span key={g.activityId}>
                {i > 0 ? ", " : ""}
                <Link
                  href={m(`/train/activities/${g.activityId}`)}
                  className="text-nh-forest"
                >
                  {g.memberName}
                </Link>
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {a.splits.length > 0 ? (
        <div className="nh-card">
          <p className="nh-label">{t("Splits")}</p>
          <div className="flex flex-col gap-1.5">
            {a.splits.map((s) => (
              <div key={s.km} className="flex items-center gap-3 text-sm">
                <span className="w-6 font-black text-nh-muted">{s.km}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-nh-raised">
                  <div
                    className="h-full rounded bg-nh-forest"
                    style={{
                      width: `${Math.max(12, (1 - (s.paceSecPerKm - maxSplitPace * 0.6) / (maxSplitPace * 0.6)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-20 text-right font-bold">
                  {formatPace(s.paceSecPerKm, units)}
                  {!s.full ? <span className="text-nh-muted"> *</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {a.efforts.length > 0 ? (
        <div className="nh-card">
          <p className="nh-label">{t("Segment efforts")}</p>
          <div className="flex flex-col gap-2">
            {a.efforts.map((e) => (
              <Link
                key={e.segmentId}
                href={m(`/train/segments/${e.segmentId}`)}
                className="flex items-center justify-between gap-2 rounded-lg bg-nh-raised px-3 py-2"
              >
                <div>
                  <p className="text-sm font-black">
                    {e.segmentName}
                    {e.isPersonalBest ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-black text-nh-forest uppercase">
                        <Award size={12} /> PR
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-nh-muted">
                    {formatDistanceM(e.distanceM, units)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-black">{formatDuration(e.elapsedSec)}</p>
                  <p className="text-xs text-nh-muted">
                    #{e.rank} {t("of")} {e.totalEfforts}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="nh-card">
        <div className="mb-3 flex items-center gap-4">
          <button
            onClick={() => kudos.mutate(a.id)}
            className={`flex items-center gap-1.5 text-sm font-bold ${a.hasKudoed ? "text-nh-forest" : "text-nh-muted"}`}
          >
            <ThumbsUp size={18} fill={a.hasKudoed ? "currentColor" : "none"} />
            {a.kudosCount} kudos
          </button>
          <span className="flex items-center gap-1.5 text-sm font-bold text-nh-muted">
            <MessageCircle size={18} /> {a.comments.length}
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {a.comments.map((c) => (
            <div key={c.id} className="text-sm">
              <p>
                <span className="font-black">{c.memberName}</span>{" "}
                <span className="text-xs text-nh-muted">
                  {formatDayTime(c.createdAt)}
                </span>
              </p>
              <p className="text-nh-muted">{c.text}</p>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className="nh-input flex-1 !py-2"
              placeholder={t("Add a comment…")}
              value={comment}
              maxLength={500}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendComment();
              }}
            />
            <button
              className="nh-btn-brand !px-4 !py-2 text-sm"
              disabled={busy || !comment.trim()}
              onClick={() => void sendComment()}
            >
              {t("Send")}
            </button>
          </div>
        </div>
      </div>

      {editOpen ? (
        <EditSheet
          activityId={a.id}
          initial={{
            title: a.title,
            description: a.description,
            visibility: a.visibility,
          }}
          onClose={() => setEditOpen(false)}
          onDone={() => {
            setEditOpen(false);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function EditSheet({
  activityId,
  initial,
  onClose,
  onDone,
}: {
  activityId: string;
  initial: {
    title: string;
    description: string;
    visibility: ActivityVisibility;
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [visibility, setVisibility] = useState<ActivityVisibility>(
    initial.visibility,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await trainApi.updateActivity(activityId, {
        title,
        description,
        visibility,
      });
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
        className="nh-sheet-panel w-full max-w-md rounded-t-3xl bg-nh-cream p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="nh-display mb-4 text-xl">{t("Edit activity")}</h2>
        <div className="flex flex-col gap-3">
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
            />
          </div>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
          {error ? (
            <p className="text-sm font-bold text-nh-danger">{error}</p>
          ) : null}
          <button
            className="nh-btn-brand"
            disabled={busy || title.length < 1}
            onClick={() => void save()}
          >
            {t("Save changes")}
          </button>
        </div>
      </div>
    </div>
  );
}
