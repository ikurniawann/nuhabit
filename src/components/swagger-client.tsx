"use client";

import dynamic from "next/dynamic";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function SwaggerClientWrapper({ url }: { url: string }) {
  return (
    <div style={{ width: "100%", minHeight: "100vh", background: "#fafafa" }}>
      <div
        style={{
          padding: "16px 24px",
          background: "#fff",
          borderBottom: "1px solid #e5e5e5",
          marginBottom: "0",
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>
          BCD Coffee OS — Purchasing Module API
        </h1>
        <p style={{ fontSize: "14px", color: "#666", margin: "4px 0 0" }}>
          OpenAPI 3.0 / Swagger Documentation
        </p>
      </div>
      <SwaggerUI url={url} persistAuth={true} deepLinking={true} />
    </div>
  );
}
