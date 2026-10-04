import SwaggerClientWrapper from "@/components/swagger-client";
import { appOrigin } from "@/lib/app-origin";

export default async function PurchasingDocsPage() {
  const baseUrl = appOrigin() || "http://localhost:3000";
  const specUrl = `${baseUrl}/api/purchasing/docs/spec`;

  return <SwaggerClientWrapper url={specUrl} />;
}
