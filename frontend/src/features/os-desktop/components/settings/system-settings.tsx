"use client";

import { Activity, Bell, ChevronRight, Command, MonitorDot, Settings, Volume2, VolumeX } from "lucide-react";
import type { AiAssistantSettings } from "@/lib/ai-assistant-config";
import { brandOsName } from "@/lib/branding";
import { WindowShell } from "../windows/window-shell";
import { AssistantModelSettings } from "./assistant-model-settings";
import { ToggleSwitch } from "./toggle-switch";

const TILE = "grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground";

export function SystemSettings({
  soundEnabled,
  assistantSettings,
  onSoundChange,
  onAssistantSettingsChange,
  onOpenWallpaper,
  onOpenWidgets,
  onOpenWaNotif,
  onOpenShortcuts,
  onClose,
}: {
  soundEnabled: boolean;
  assistantSettings: AiAssistantSettings;
  onSoundChange: (value: boolean) => void;
  onAssistantSettingsChange: (next: Partial<AiAssistantSettings>) => void;
  onOpenWallpaper: () => void;
  onOpenWidgets: () => void;
  onOpenWaNotif: () => void;
  onOpenShortcuts: () => void;
  onClose: () => void;
}) {
  const brandOs = brandOsName();
  const links = [
    { title: "Desktop & Wallpaper", description: `Pilih wallpaper ${brandOs}.`, icon: MonitorDot, action: onOpenWallpaper },
    { title: "Widgets", description: "Atur Calendar dan System Widgets.", icon: Activity, action: onOpenWidgets },
    { title: "Notifikasi WA", description: "Kabar penting bisnis dikirim otomatis ke WhatsApp.", icon: Bell, action: onOpenWaNotif },
    { title: "Pintasan Papan Ketik", description: "Tutup, kecilkan, pindah, dan tempel jendela tanpa mouse.", icon: Command, action: onOpenShortcuts },
  ];
  const SoundIcon = soundEnabled ? Volume2 : VolumeX;

  return (
    <WindowShell title="System Settings" onClose={onClose} className="left-1/2 top-16 w-[min(760px,calc(100vw-32px))] -translate-x-1/2">
      <div className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
        <aside className="rounded-3xl border border-white/10 bg-white/8 p-4">
          <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground"><Settings className="size-6" /></div>
          <div className="font-semibold">{brandOs} Settings</div>
          <div className="mt-1 text-xs leading-5 text-white/50">Theme, widgets, sound, Do, dan desktop preferences.</div>
        </aside>
        <section className="space-y-3">
          <AssistantModelSettings settings={assistantSettings} onChange={onAssistantSettingsChange} />
          {links.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.title} onClick={item.action} className="flex w-full items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4 text-left transition hover:bg-white/12">
                <div className={TILE}><Icon className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="text-xs leading-5 text-white/45">{item.description}</div>
                </div>
                <ChevronRight className="size-4 text-white/35" />
              </button>
            );
          })}
          <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/8 p-4">
            <div className={TILE}><SoundIcon className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Sound Effects</div>
              <div className="text-xs leading-5 text-white/45">Subtle click sound ala desktop OS. Default off.</div>
            </div>
            <ToggleSwitch enabled={soundEnabled} onChange={onSoundChange} label="Toggle sound effects" />
          </div>
        </section>
      </div>
    </WindowShell>
  );
}
