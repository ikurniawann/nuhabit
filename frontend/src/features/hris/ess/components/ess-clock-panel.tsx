"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Clock, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CameraCapture } from "@/components/hris/CameraCapture";
import { formatTime } from "@/lib/format";
import { useTodayAttendance } from "../queries";
import { useSubmitClock } from "../mutations";
import type { EssClockLocation, EssClockPayload } from "../types";

/**
 * Panel clock-in/out ESS: selfie kamera WAJIB + lokasi GPS.
 * Alur: klik tombol → kamera (capture+konfirmasi) → ambil GPS → POST.
 * State absensi hari ini dipulihkan dari server (tahan refresh). Setelah
 * berhasil, mutasi menyegarkan beranda dan kalender absensi.
 */

type ClockAction = EssClockPayload["action"];

function getLocation(): Promise<EssClockLocation | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

export function EssClockPanel() {
  const todayQuery = useTodayAttendance();
  const today = todayQuery.data ?? null;
  const clock = useSubmitClock();
  const [locating, setLocating] = useState<ClockAction | null>(null);
  const [cameraFor, setCameraFor] = useState<ClockAction | null>(null);
  const pendingAction = locating ?? (clock.isPending ? clock.variables?.action : null);
  const submitting = pendingAction != null;

  async function submit(action: ClockAction, photo: string) {
    setCameraFor(null);
    setLocating(action);
    const location = await getLocation();
    setLocating(null);

    const payload: EssClockPayload = { action, photo };
    if (action === "clock-in") {
      if (location) payload.clock_in_location = location;
    } else {
      payload.attendance_id = today?.id;
      if (location) payload.clock_out_location = location;
    }

    clock.mutate(payload, {
      onSuccess: (json) => {
        const late = json.data?.is_late ? ` — terlambat ${json.data.late_minutes} menit` : "";
        toast.success(action === "clock-in" ? "✅ Clock-in berhasil" : "✅ Clock-out berhasil", {
          description: `${formatTime(new Date())}${late}${location ? " · 📍 lokasi tercatat" : ""}`,
        });
      },
      onError: (error) => toast.error("Gagal", { description: error.message || "Coba lagi" }),
    });
  }

  const clockedIn = Boolean(today?.clock_in);
  const clockedOut = Boolean(today?.clock_out);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          disabled={todayQuery.isLoading || submitting || clockedIn}
          onClick={() => setCameraFor("clock-in")}
        >
          {pendingAction === "clock-in" ? <Loader2 className="animate-spin" aria-hidden /> : <Clock aria-hidden />}
          Clock In
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={todayQuery.isLoading || submitting || !clockedIn || clockedOut}
          onClick={() => setCameraFor("clock-out")}
        >
          {pendingAction === "clock-out" ? <Loader2 className="animate-spin" aria-hidden /> : <Clock aria-hidden />}
          Clock Out
        </Button>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden /> Foto selfie & lokasi GPS wajib disertakan
        </p>
      </div>

      {today && clockedIn && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Masuk <b>{formatTime(today.clock_in)}</b>
            {clockedOut ? (
              <>
                {" "}· Pulang <b>{formatTime(today.clock_out)}</b>
              </>
            ) : null}
          </span>
          {today.is_late ? (
            <Badge variant="destructive">
              Terlambat {today.late_minutes} mnt
            </Badge>
          ) : (
            <Badge variant="success">Tepat waktu</Badge>
          )}
          {clockedOut && (
            <Badge variant="outline" className="text-success">
              Absensi hari ini selesai
            </Badge>
          )}
        </div>
      )}

      <CameraCapture
        open={cameraFor !== null}
        title={cameraFor === "clock-out" ? "Selfie Clock-Out" : "Selfie Clock-In"}
        onConfirm={(photo) => cameraFor && submit(cameraFor, photo)}
        onCancel={() => setCameraFor(null)}
      />
    </div>
  );
}
