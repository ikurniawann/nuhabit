"use client";

import { useState } from "react";
import { Folder, Loader2, Lock } from "lucide-react";
import { brandName } from "@/lib/branding";
import { DriveDataroomBrowser } from "@/features/dataroom/components/drive-browser";
import type { DataroomItem } from "@/features/dataroom/types";
import { useDataroomRoots } from "../../hooks/use-drive";
import { WindowShell } from "../windows/window-shell";
import { ReportsExplorer } from "./reports-explorer";

type DriveLocation = { kind: "folder"; folder: DataroomItem } | { kind: "reports" };

function LocationButton({ active, label, lock, onClick }: { active: boolean; label: string; lock?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition hover:bg-white/10 ${active ? "bg-white/14 text-white" : "text-white/65"}`}>
      <Folder className="size-4 shrink-0 text-pink-200" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {lock ? <Lock className="size-3 shrink-0 text-amber-200/70" /> : null}
    </button>
  );
}

/**
 * Jendela Drive (owner 2026-09-05): lokasi = folder departemen di Dataroom
 * + Reports. Klik departemen → isi Dataroom 1:1 dengan dashboard. Sebelum
 * pengguna memilih, folder pertama dibuka; tanpa folder → Reports.
 */
export function FileExplorer({ onClose, isLoggedIn }: { onClose: () => void; isLoggedIn: boolean }) {
  const roots = useDataroomRoots(isLoggedIn);
  const [picked, setPicked] = useState<DriveLocation | null>(null);
  const firstFolder = roots.data?.[0];
  const location: DriveLocation = picked ?? (firstFolder ? { kind: "folder", folder: firstFolder } : { kind: "reports" });
  const brand = brandName();

  const title = location.kind === "reports" ? "Reports" : location.folder.name;
  const subtitle =
    location.kind === "reports" ? "Laporan POS · unduh Excel per rentang tanggal" : "Dataroom · isi sama dengan Dashboard → Dataroom";

  return (
    <WindowShell title={`${brand} Drive`} onClose={onClose} className="left-1/2 top-16 h-[min(620px,calc(100vh-120px))] w-[min(860px,calc(100vw-32px))] -translate-x-1/2">
      <div className="flex h-full min-h-[420px]">
        <aside className="flex w-56 flex-col border-r border-white/10 bg-black/12 p-3">
          <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Locations</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!isLoggedIn ? (
              <p className="px-3 py-2 text-xs text-white/45">Login untuk melihat folder departemen.</p>
            ) : roots.isPending ? (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-white/45"><Loader2 className="size-3 animate-spin" /> Memuat…</p>
            ) : roots.error ? (
              <p className="px-3 py-2 text-xs text-rose-200/80">{roots.error.message || "Gagal memuat Dataroom"}</p>
            ) : roots.data.length === 0 ? (
              <p className="px-3 py-2 text-xs text-white/45">Belum ada folder di Dataroom.</p>
            ) : (
              roots.data.map((folder) => (
                <LocationButton
                  key={folder.id}
                  active={location.kind === "folder" && location.folder.id === folder.id}
                  label={folder.name}
                  lock={Boolean(folder.departments?.length)}
                  onClick={() => setPicked({ kind: "folder", folder })}
                />
              ))
            )}
            <div className="my-2 h-px bg-white/10" />
            <LocationButton active={location.kind === "reports"} label="Reports" onClick={() => setPicked({ kind: "reports" })} />
          </div>
          <div className="mt-3 rounded-3xl border border-white/10 bg-white/8 p-3 text-xs leading-5 text-white/50">
            {isLoggedIn ? `Connected to ${brand} workspace.` : "Login required to open or download real files."}
          </div>
        </aside>
        <section className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="text-xs text-white/45">{subtitle}</p>
          </div>
          {location.kind === "reports" ? (
            <ReportsExplorer isLoggedIn={isLoggedIn} />
          ) : (
            <DriveDataroomBrowser key={location.folder.id} rootId={location.folder.id} rootName={location.folder.name} />
          )}
        </section>
      </div>
    </WindowShell>
  );
}
