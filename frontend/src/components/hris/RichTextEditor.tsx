"use client";

import { useEffect, useRef } from "react";

/**
 * Editor teks kaya berbasis Quill (sudah jadi dependency & CSS di-import
 * global di layout). Emit HTML via onChange. Toolbar dibatasi ke format
 * yang di-allowlist saat render (lihat ANNOUNCEMENT_SANITIZE_CONFIG).
 */

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // Simpan nilai awal sekali; update berikutnya dikendalikan Quill sendiri
  const initialRef = useRef(value);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let mounted = true;
    host.innerHTML = "";

    import("quill").then(({ default: Quill }) => {
      if (!mounted || !host) return;
      const editorNode = document.createElement("div");
      host.appendChild(editorNode);

      const quill = new Quill(editorNode, {
        theme: "snow",
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ["bold", "italic", "underline", "strike"],
            [{ list: "ordered" }, { list: "bullet" }],
            ["blockquote"],
            ["link"],
            ["clean"],
          ],
        },
        placeholder: placeholder ?? "Tulis isi pengumuman di sini...",
      });

      if (initialRef.current) {
        quill.clipboard.dangerouslyPasteHTML(initialRef.current);
      }
      quill.on("text-change", () => {
        const html = quill.getText().trim().length === 0 ? "" : quill.root.innerHTML;
        onChangeRef.current(html);
      });
    });

    return () => {
      mounted = false;
      if (host) host.innerHTML = "";
    };
    // Init sekali; nilai awal diambil dari initialRef
  }, [placeholder]);

  return <div ref={hostRef} className="rounded-lg bg-white [&_.ql-container]:min-h-40" />;
}
