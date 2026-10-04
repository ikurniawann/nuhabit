"use client";

import {
  ReceivingWorkspacePage,
  CreateGrnPage,
  ContinueGrnPage,
  GRNDetailPage,
  QCInspectionPage,
} from "../../grn";

export function ProductReceiveWorkspacePage() {
  return <ReceivingWorkspacePage moduleType="product" />;
}

export function ProductCreateReceivePage() {
  return <CreateGrnPage moduleType="product" />;
}

export function ProductContinueReceivePage() {
  return <ContinueGrnPage moduleType="product" />;
}

export function ProductReceiveDetailPage() {
  return <GRNDetailPage moduleType="product" />;
}

export function ProductReceiveQcPage() {
  return <QCInspectionPage moduleType="product" />;
}
