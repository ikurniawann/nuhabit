"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import type { PathWindow } from "../../hooks/use-path-windows";
import { NATIVE_INTEGRATION_MODULE, type DesktopModule } from "../../lib/modules";
import { IntegrationSettingsNative } from "./integration-settings-native";
import { WindowShell } from "./window-shell";

const FRAME_WINDOW_CLASS = "left-1/2 top-16 h-[min(700px,calc(100vh-120px))] w-[min(1200px,calc(100vw-32px))] -translate-x-1/2";
const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups";

/** Jendela modul: halaman dashboard di dalam iframe (Integration tampil native). */
export function ApplicationWindow({ module, url, onClose }: { module: DesktopModule; url: string; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <WindowShell title={module.name} onClose={onClose} className={FRAME_WINDOW_CLASS}>
      <div className="flex h-full flex-col">
        {module.name === NATIVE_INTEGRATION_MODULE ? (
          <IntegrationSettingsNative />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="rounded-full bg-red-500/10 p-4">
              <AlertCircle className="size-8 text-red-500" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900">Failed to load</h3>
              <p className="text-sm text-gray-500">Unable to load the application</p>
            </div>
            <button onClick={onClose} className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-pink-500">
              Close
            </button>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                <div className="mb-4 grid size-16 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-xl">
                  <Loader2 className="size-8 animate-spin" />
                </div>
                <p className="text-sm font-medium text-gray-600">Loading {module.name}...</p>
              </div>
            )}
            <iframe
              src={url}
              className="h-full w-full bg-white"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setError(true);
                setIsLoading(false);
              }}
              title={module.name}
              sandbox={FRAME_SANDBOX}
            />
          </>
        )}
      </div>
    </WindowShell>
  );
}

/** windowId unik supaya beberapa instans halaman yang sama bisa hidup berdampingan. */
export function PathWindowFrame({ window: win, onClose }: { window: PathWindow; onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(true);
  return (
    <WindowShell windowId={win.id} title={win.title} onClose={onClose} className={FRAME_WINDOW_CLASS}>
      <div className="relative flex h-full flex-col">
        {isLoading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-slate-100">
            <Loader2 className="size-8 animate-spin text-pink-500" />
          </div>
        )}
        <iframe src={win.path} className="h-full w-full bg-white" onLoad={() => setIsLoading(false)} title={win.title} sandbox={FRAME_SANDBOX} />
      </div>
    </WindowShell>
  );
}
