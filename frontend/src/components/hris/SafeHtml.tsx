"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { ANNOUNCEMENT_SANITIZE_CONFIG } from "@/lib/hris/announcements";

/**
 * Render HTML pengumuman dengan sanitasi DOMPurify (allowlist tag/atribut
 * yang sama dengan editor). Semua tampilan body_html WAJIB lewat komponen
 * ini — jangan pernah dangerouslySetInnerHTML langsung dari data.
 */
export function SafeHtml({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => {
    const sanitized = DOMPurify.sanitize(html ?? "", {
      ALLOWED_TAGS: [...ANNOUNCEMENT_SANITIZE_CONFIG.ALLOWED_TAGS],
      ALLOWED_ATTR: [...ANNOUNCEMENT_SANITIZE_CONFIG.ALLOWED_ATTR],
      ALLOWED_URI_REGEXP: ANNOUNCEMENT_SANITIZE_CONFIG.ALLOWED_URI_REGEXP,
    });
    return sanitized;
  }, [html]);

  return (
    <div
      className={className}
      // Sudah disanitasi DOMPurify tepat di atas — aman.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
