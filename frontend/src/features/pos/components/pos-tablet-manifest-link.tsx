"use client";

import { useEffect } from "react";

const MANIFEST_HREF = "/manifest-pos.webmanifest";
const LINK_ID = "arkiv-pos-manifest";

/**
 * Inject POS PWA manifest + apple web-app meta while on immersive/tablet POS.
 * Cleans up when leaving so the rest of the dashboard is unaffected.
 */
export function PosTabletManifestLink() {
  useEffect(() => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = LINK_ID;
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = MANIFEST_HREF;

    const metas: Array<{ name: string; content: string }> = [
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "POS Kasir" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "theme-color", content: "#e11d48" },
    ];

    const created: HTMLMetaElement[] = [];
    for (const spec of metas) {
      const existing = document.querySelector(
        `meta[name="${spec.name}"][data-pos-tablet="1"]`
      );
      if (existing) continue;
      const meta = document.createElement("meta");
      meta.name = spec.name;
      meta.content = spec.content;
      meta.dataset.posTablet = "1";
      document.head.appendChild(meta);
      created.push(meta);
    }

    return () => {
      document.getElementById(LINK_ID)?.remove();
      for (const meta of created) meta.remove();
      document
        .querySelectorAll('meta[data-pos-tablet="1"]')
        .forEach((node) => node.remove());
    };
  }, []);

  return null;
}
