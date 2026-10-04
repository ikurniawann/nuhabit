"use client";

import { use } from "react";
import { NewPOPage } from "./new-po-page";

type EditPOPageProps = {
  params: Promise<{ id: string }>;
};

export function EditPOPage({ params }: EditPOPageProps) {
  const { id } = use(params);
  return <NewPOPage poId={id} />;
}
