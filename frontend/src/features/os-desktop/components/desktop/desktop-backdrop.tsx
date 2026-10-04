import { wallpaperBackgroundStyle } from "@/lib/desktop/wallpapers";

/** Wallpaper + lapisan grid & cahaya yang bergeser mengikuti mouse (CSS variable parallax). */
export function DesktopBackdrop({ src }: { src: string }) {
  return (
    <>
      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={wallpaperBackgroundStyle(src)} />
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 opacity-[0.16] transition-transform duration-500 ease-out [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:80px_80px] [transform:translate3d(var(--float-x-reverse),var(--float-y-reverse),0)]" />
      <div className="pointer-events-none absolute -left-24 top-24 size-72 rounded-full bg-cyan-300/14 blur-3xl transition-transform duration-500 ease-out [transform:translate3d(var(--float-x),var(--float-y),0)]" />
      <div className="pointer-events-none absolute -right-24 bottom-16 size-80 rounded-full bg-pink-400/14 blur-3xl transition-transform duration-500 ease-out [transform:translate3d(var(--float-x-reverse),var(--float-y-reverse),0)]" />
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/10 to-transparent" />
    </>
  );
}
