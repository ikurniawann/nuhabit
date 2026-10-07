/**
 * Parser URL video pengumuman — hanya provider whitelist (YouTube/Vimeo).
 * Kita simpan provider + id hasil parse, lalu render iframe kita SENDIRI
 * (bukan HTML mentah dari user) untuk mencegah XSS via embed.
 */

export type VideoProvider = "youtube" | "vimeo";

export interface ParsedVideo {
  provider: VideoProvider;
  id: string;
  /** URL embed aman untuk src iframe */
  embedUrl: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

/**
 * Parse URL YouTube/Vimeo menjadi { provider, id, embedUrl }.
 * Return null bila bukan URL video provider yang didukung.
 */
export function parseVideoUrl(input: string): ParsedVideo | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  // ---- YouTube ----
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return youtube(id);
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") return youtube(url.searchParams.get("v") ?? "");
    const parts = url.pathname.split("/").filter(Boolean);
    // /embed/<id>, /shorts/<id>, /v/<id>
    if (["embed", "shorts", "v"].includes(parts[0])) return youtube(parts[1] ?? "");
    return null;
  }

  // ---- Vimeo ----
  if (host === "vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    // vimeo.com/<id> atau vimeo.com/channels/.../<id>
    const id = parts[parts.length - 1] ?? "";
    return vimeo(id);
  }
  if (host === "player.vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    // player.vimeo.com/video/<id>
    if (parts[0] === "video") return vimeo(parts[1] ?? "");
    return null;
  }

  return null;
}

function youtube(id: string): ParsedVideo | null {
  if (!YOUTUBE_ID.test(id)) return null;
  return {
    provider: "youtube",
    id,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
  };
}

function vimeo(id: string): ParsedVideo | null {
  if (!VIMEO_ID.test(id)) return null;
  return {
    provider: "vimeo",
    id,
    embedUrl: `https://player.vimeo.com/video/${id}`,
  };
}

/** Susun ulang embedUrl dari provider+id tersimpan (tanpa parsing ulang). */
export function embedUrlFor(provider: string, id: string): string | null {
  if (provider === "youtube" && YOUTUBE_ID.test(id)) {
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  if (provider === "vimeo" && VIMEO_ID.test(id)) {
    return `https://player.vimeo.com/video/${id}`;
  }
  return null;
}
