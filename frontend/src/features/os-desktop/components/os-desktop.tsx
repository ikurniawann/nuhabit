"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Bot, Folder, Settings } from "lucide-react";
import { brandName } from "@/lib/branding";
import type { ActivityNotification } from "@/lib/desktop/notifications";
import { useActivityFeed } from "../hooks/use-activity-feed";
import { useAssistantChat } from "../hooks/use-assistant-chat";
import { useAssistantSettings } from "../hooks/use-assistant-settings";
import { useDesktopAccount } from "../hooks/use-desktop-account";
import { INITIAL_MOTION_STYLE, useParallax, playClickSound, useClock } from "../hooks/use-desktop-chrome";
import { useDesktopKeyboard } from "../hooks/use-desktop-keyboard";
import { useDesktopOverview } from "../hooks/use-desktop-overview";
import { useDesktopPreferences } from "../hooks/use-desktop-preferences";
import { usePathWindows } from "../hooks/use-path-windows";
import { usePeriodPreference } from "../hooks/use-period-preference";
import { WindowApiContext, WindowStateContext, useWindowManager } from "../hooks/use-window-manager";
import { OS_LOGIN_HREF, moduleHref, type DesktopModule } from "../lib/modules";
import { CLOSED_PANELS, panelReducer, type PanelName } from "../lib/panels";
import { moveWidget, reorderWidget } from "../lib/preferences";
import { AssistantShortcutBar } from "./assistant/assistant-shortcut-bar";
import { AssistantWindow } from "./assistant/assistant-window";
import { DesktopBackdrop } from "./desktop/desktop-backdrop";
import { DesktopContextMenu } from "./desktop/desktop-context-menu";
import { Dock } from "./dock/dock";
import { FileExplorer } from "./files/file-explorer";
import { AppLibrary } from "./launchpad/app-library";
import { CommandPalette } from "./launchpad/command-palette";
import { ModuleOpenChoice } from "./launchpad/module-open-choice";
import { LockScreen } from "./lock-screen/lock-screen";
import { AccountPopup } from "./menubar/account-popup";
import { Menubar } from "./menubar/menubar";
import { NotificationCenter, NotificationPopups } from "./notifications/notification-center";
import { TodayPanel } from "./notifications/today-panel";
import { AboutWindow, ShortcutCheatSheet } from "./settings/info-windows";
import { SystemSettings } from "./settings/system-settings";
import { WaNotifSettingsPanel } from "./settings/wa-notif-settings";
import { WallpaperPicker } from "./settings/wallpaper-picker";
import { CalendarWidget } from "./widgets/calendar-widget";
import { MonitorBoard } from "./widgets/monitor-board";
import { WidgetSettings } from "./widgets/widget-settings";
import { ApplicationWindow, PathWindowFrame } from "./windows/frame-windows";
import { WindowShell } from "./windows/window-shell";

/** Desktop NüHabit OS: menubar, papan monitoring, dock, dan jendela modul. */
export default function OsDesktop() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const account = useDesktopAccount();
  const isLoggedIn = Boolean(account);
  const now = useClock();
  const desktopRef = useRef<HTMLElement>(null);
  const parallax = useParallax(desktopRef);
  const [panels, dispatch] = useReducer(panelReducer, CLOSED_PANELS);
  const open = (panel: PanelName) => dispatch({ type: "open", panel });
  const close = (panel: PanelName) => dispatch({ type: "close", panel });
  const toggle = (panel: PanelName) => dispatch({ type: "toggle", panel });

  const prefs = useDesktopPreferences(isLoggedIn);
  const [assistantSettings, updateAssistantSettings] = useAssistantSettings();
  const [periode, pilihPeriode] = usePeriodPreference();
  const feed = useActivityFeed(isLoggedIn);
  const overview = useDesktopOverview(isLoggedIn, periode, feed.ingest);
  const windowManager = useWindowManager();
  const { windows: openWindows, order: windowOrder } = windowManager.state;
  const pathWindows = usePathWindows(windowManager.api.focus);

  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [moduleChoice, setModuleChoice] = useState<DesktopModule | null>(null);
  const [appModule, setAppModule] = useState<DesktopModule | null>(null);
  const [shortcutInput, setShortcutInput] = useState("");
  const chat = useAssistantChat({ settings: assistantSettings, isAllowed: isLoggedIn, windowOpen: panels.assistant });
  const shortcutInputRef = useRef<HTMLInputElement>(null);
  const driveTitle = `${brandName()} Drive`;

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openAssistantShortcut = useCallback(() => {
    dispatch({ type: "open", panel: "assistantShortcut" });
    window.requestAnimationFrame(() => shortcutInputRef.current?.focus());
  }, []);
  const dismissAssistantShortcut = useCallback(() => dispatch({ type: "close", panel: "assistantShortcut" }), []);

  // Data desktop terikat sesi login: dibuang saat desktop ditutup supaya
  // kunjungan berikutnya (mis. setelah login/ganti user) mulai bersih.
  useEffect(() => () => queryClient.removeQueries({ queryKey: ["os-desktop"] }), [queryClient]);

  useDesktopKeyboard({
    dispatch,
    todayOpen: panels.today,
    commandOpen: panels.command,
    contextMenuOpen: Boolean(contextMenu),
    closeContextMenu,
    openAssistantShortcut,
    windowApi: windowManager.api,
    topWindowId: windowManager.topWindowId,
    visibleOrder: windowManager.visibleOrder,
  });

  /** Ikon dock: jendela sudah terbuka → fokuskan (bukan tutup); belum → buka. */
  const focusOrOpen = (id: string, openPanel: () => void) => {
    if (openWindows[id]) windowManager.api.focus(id);
    else openPanel();
  };

  const openAssistant = () => {
    if (!panels.assistant) chat.restoreLastSession();
    open("assistant");
  };

  /**
   * "Tanya Do" dari widget / bilah ⌘⇧A: buka Do dan langsung kirim
   * pertanyaannya. Jendela tertutup → percakapan baru; terbuka → lanjut.
   */
  const askDo = (prompt: string) => {
    chat.sendMessage(prompt, { fresh: !panels.assistant });
    open("assistant");
  };

  const openNotification = (n: ActivityNotification) => {
    feed.dismiss(n.id);
    router.push(n.href);
  };

  const openModuleInOs = (module: DesktopModule) => {
    setAppModule(module);
    setModuleChoice(null);
  };

  const openModuleInNewTab = (module: DesktopModule) => {
    window.open(moduleHref(module, isLoggedIn), "_blank", "noopener,noreferrer");
    setModuleChoice(null);
  };

  const openWindowList = windowOrder.map((id) => ({ id, ...openWindows[id] })).filter((win) => win.title);

  return (
    <WindowApiContext.Provider value={windowManager.api}>
      <WindowStateContext.Provider value={windowManager.state}>
        <main
          ref={desktopRef}
          onMouseMove={parallax.onMouseMove}
          onMouseLeave={parallax.onMouseLeave}
          onClick={closeContextMenu}
          onClickCapture={prefs.soundEnabled ? playClickSound : undefined}
          onContextMenu={(event) => {
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY });
          }}
          style={INITIAL_MOTION_STYLE}
          className="relative min-h-dvh overflow-hidden bg-ink text-white"
        >
          <DesktopBackdrop src={prefs.wallpaper.src} />

          <Menubar
            email={account?.email ?? null}
            isLoggedIn={isLoggedIn}
            now={now}
            notificationCount={feed.history.length}
            onAccount={() => open("account")}
            onLogin={() => router.push(OS_LOGIN_HREF)}
            onApplications={() => open("library")}
            onNotifications={() => open("notifications")}
            onWidgets={() => open("widgets")}
            onSearch={() => open("command")}
            onToday={() => open("today")}
          />

          <section className="relative z-10 min-h-dvh px-6 pb-28 pt-14">
            {prefs.visibility.calendar && <CalendarWidget date={now} onClose={() => prefs.setWidgetVisible("calendar", false)} />}
            {isLoggedIn && (
              <MonitorBoard
                state={overview}
                visibility={prefs.visibility}
                order={prefs.order}
                periode={periode}
                onPilihPeriode={pilihPeriode}
                onAskDo={askDo}
                onOpenInbox={() => open("today")}
              />
            )}
          </section>

          <Dock
            launchpadOpen={panels.library}
            onToggleLaunchpad={() => toggle("library")}
            assistant={{ label: "Do", icon: Bot, active: panels.assistant, running: Boolean(openWindows.Do), onClick: () => focusOrOpen("Do", openAssistant) }}
            apps={[
              ...(feed.history.length > 0
                ? [{ label: `Notifications (${feed.history.length})`, icon: Bell, active: panels.notifications, onClick: () => toggle("notifications") }]
                : []),
              { label: "Files", icon: Folder, active: panels.files, running: Boolean(openWindows[driveTitle]), onClick: () => focusOrOpen(driveTitle, () => open("files")) },
              {
                label: "Settings",
                icon: Settings,
                active: panels.settings,
                running: Boolean(openWindows["System Settings"]),
                onClick: () => focusOrOpen("System Settings", () => open("settings")),
              },
            ]}
            windows={openWindowList}
            activeWindowId={windowManager.topWindowId}
            onFocusWindow={windowManager.api.focus}
          />

          {panels.assistantShortcut && (
            <AssistantShortcutBar
              inputRef={shortcutInputRef}
              value={shortcutInput}
              onChange={setShortcutInput}
              onSubmit={() => askDo(shortcutInput.trim())}
              onNewChat={openAssistant}
              onDismiss={dismissAssistantShortcut}
            />
          )}

          {panels.library && <AppLibrary onClose={() => close("library")} onOpen={setModuleChoice} />}
          {panels.command && (
            <CommandPalette
              query={query}
              setQuery={setQuery}
              isLoggedIn={isLoggedIn}
              onClose={() => close("command")}
              onOpen={setModuleChoice}
              onOpenPath={pathWindows.open}
              onAssistant={openAssistant}
              onNotifications={() => open("notifications")}
              onWallpaper={() => open("wallpaper")}
              onWidgets={() => open("widgets")}
              onFiles={() => open("files")}
              onSettings={() => open("settings")}
            />
          )}
          {pathWindows.windows.map((win) => (
            <PathWindowFrame key={win.id} window={win} onClose={() => pathWindows.close(win.id)} />
          ))}
          {panels.waNotif && (
            <WindowShell
              title="Notifikasi WA"
              onClose={() => close("waNotif")}
              className="left-1/2 top-14 max-h-[calc(100vh-140px)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto"
            >
              <WaNotifSettingsPanel />
            </WindowShell>
          )}
          {panels.notifications && feed.history.length > 0 && (
            <NotificationCenter
              items={feed.history}
              onOpen={openNotification}
              onClear={() => {
                feed.clear();
                close("notifications");
              }}
              onClose={() => close("notifications")}
            />
          )}
          <NotificationPopups popups={feed.popups} onDismiss={feed.dismiss} onOpen={openNotification} />
          {panels.files && <FileExplorer onClose={() => close("files")} isLoggedIn={isLoggedIn} />}
          {panels.wallpaper && (
            <WallpaperPicker
              items={prefs.wallpapers}
              selected={prefs.wallpaper.id}
              canManage={account?.role === "super_admin" || account?.role === "admin"}
              onSelect={prefs.selectWallpaper}
              onUploaded={prefs.selectWallpaper}
              onDeleted={prefs.forgetWallpaper}
              onClose={() => close("wallpaper")}
            />
          )}
          {panels.widgets && (
            <WidgetSettings
              visibility={prefs.visibility}
              order={prefs.order}
              onChange={prefs.setWidgetVisible}
              onMove={(key, direction) => {
                const next = moveWidget(prefs.order, key, direction);
                if (next) prefs.setWidgetOrder(next);
              }}
              onReorder={(from, to) => {
                const next = reorderWidget(prefs.order, from, to);
                if (next) prefs.setWidgetOrder(next);
              }}
              onClose={() => close("widgets")}
            />
          )}
          {panels.settings && (
            <SystemSettings
              soundEnabled={prefs.soundEnabled}
              assistantSettings={assistantSettings}
              onSoundChange={prefs.setSoundEnabled}
              onAssistantSettingsChange={updateAssistantSettings}
              onOpenWallpaper={() => open("wallpaper")}
              onOpenWidgets={() => open("widgets")}
              onOpenWaNotif={() => {
                close("settings");
                open("waNotif");
              }}
              onOpenShortcuts={() => open("shortcuts")}
              onClose={() => close("settings")}
            />
          )}
          {panels.about && <AboutWindow onClose={() => close("about")} />}
          {panels.assistant && <AssistantWindow chat={chat} isAllowed={isLoggedIn} onClose={() => close("assistant")} />}
          {appModule && <ApplicationWindow module={appModule} url={moduleHref(appModule, isLoggedIn)} onClose={() => setAppModule(null)} />}
          {moduleChoice && (
            <ModuleOpenChoice
              module={moduleChoice}
              isLoggedIn={isLoggedIn}
              onClose={() => setModuleChoice(null)}
              onOpenInside={() => openModuleInOs(moduleChoice)}
              onOpenNewTab={() => openModuleInNewTab(moduleChoice)}
            />
          )}
          {panels.account && (
            <AccountPopup
              account={account}
              onClose={() => close("account")}
              onLogin={() => router.push(OS_LOGIN_HREF)}
              onDashboard={() => router.push("/dashboard")}
              onLock={() => {
                close("account");
                open("locked");
              }}
            />
          )}
          {panels.locked && account && (
            <LockScreen
              account={account}
              onUnlock={() => close("locked")}
              onSwitchUser={async () => {
                await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                router.push(OS_LOGIN_HREF);
              }}
            />
          )}
          {panels.shortcuts && <ShortcutCheatSheet onClose={() => close("shortcuts")} />}
          {panels.today && (
            <TodayPanel
              overview={overview.data}
              onClose={() => close("today")}
              onOpenPath={(path, title) => {
                close("today");
                pathWindows.open(path, title);
              }}
            />
          )}
          {contextMenu && (
            <DesktopContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onApps={() => open("library")}
              onWidgets={() => open("widgets")}
              onSettings={() => open("settings")}
              onWallpaper={() => open("wallpaper")}
              onAbout={() => open("about")}
            />
          )}
        </main>
      </WindowStateContext.Provider>
    </WindowApiContext.Provider>
  );
}
