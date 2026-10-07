"use client";

import {
  PurchaseReturnsPage,
  ReturnDetailPage,
  NewReturnPage,
  EditReturnPage,
} from "../../returns";

export function ProductReturnsListPage() {
  return <PurchaseReturnsPage moduleType="product" />;
}

export function ProductReturnDetailPage() {
  return <ReturnDetailPage moduleType="product" />;
}

export function ProductNewReturnPage() {
  return <NewReturnPage moduleType="product" />;
}

export function ProductEditReturnPage() {
  return <EditReturnPage moduleType="product" />;
}
