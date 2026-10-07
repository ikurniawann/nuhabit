import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";

export const dynamic = "force-static";
export const maxDuration = 60;

const spec = {
  openapi: "3.0.3",
  info: {
    title: "NüHabit OS Purchasing Module API",
    version: "1.0.0",
    description: "REST API for NüHabit OS Purchasing Module — Suppliers, Purchase Orders, Materials",
  },
  servers: [{ url: appOrigin() || "http://localhost:3000" }],
  paths: {
    "/api/purchasing/suppliers": {
      get: {
        tags: ["Suppliers"],
        summary: "List suppliers",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive"] } },
          { name: "payment_terms", in: "query", schema: { type: "string" } },
          { name: "sort_by", in: "query", schema: { type: "string" } },
          { name: "sort_order", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "Paginated supplier list" } },
      },
      post: {
        tags: ["Suppliers"],
        summary: "Create supplier",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "Supplier created" } },
      },
    },
    "/api/purchasing/suppliers/{id}": {
      get: {
        tags: ["Suppliers"],
        summary: "Get supplier by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Supplier detail with analytics" } },
      },
      put: {
        tags: ["Suppliers"],
        summary: "Update supplier",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Supplier updated" } },
      },
      delete: {
        tags: ["Suppliers"],
        summary: "Deactivate supplier",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Supplier deactivated" } },
      },
    },
    "/api/purchasing/suppliers/{id}/prices": {
      get: {
        tags: ["Suppliers"],
        summary: "Get supplier material prices",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Price list" } },
      },
    },
    "/api/purchasing/suppliers/{id}/po-history": {
      get: {
        tags: ["Suppliers"],
        summary: "Get PO history for supplier",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "start_date", in: "query", schema: { type: "string" } },
          { name: "end_date", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "PO history" } },
      },
    },
    "/api/purchasing/po": {
      get: {
        tags: ["Purchase Orders"],
        summary: "List purchase orders",
        parameters: [
          { name: "supplier_id", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "Paginated PO list" } },
      },
      post: {
        tags: ["Purchase Orders"],
        summary: "Create purchase order",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "PO created" } },
      },
    },
    "/api/purchasing/po/{id}": {
      get: {
        tags: ["Purchase Orders"],
        summary: "Get PO by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "PO detail" } },
      },
      put: {
        tags: ["Purchase Orders"],
        summary: "Update PO",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "PO updated" } },
      },
    },
    "/api/purchasing/materials": {
      get: {
        tags: ["Materials"],
        summary: "List materials",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "Paginated material list" } },
      },
      post: {
        tags: ["Materials"],
        summary: "Create material",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "Material created" } },
      },
    },
    "/api/purchasing/materials/{id}": {
      get: {
        tags: ["Materials"],
        summary: "Get material by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Material detail" } },
      },
      put: {
        tags: ["Materials"],
        summary: "Update material",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Material updated" } },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(spec, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
