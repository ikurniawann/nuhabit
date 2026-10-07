"use client";

import { useEffect } from "react";

type PrintDocumentTitleProps = {
  title: string;
};

export function PrintDocumentTitle({ title }: PrintDocumentTitleProps) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
