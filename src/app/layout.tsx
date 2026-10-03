import type { Metadata } from "next";
import "./globals.css";
import { brandName, brandOsName } from "@/lib/branding";
import "quill/dist/quill.snow.css";
import QueryProvider from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeScript } from "@/components/providers/theme-script";
import { ToastProvider } from "@/components/providers/toast-provider";
import { ActivityLogProvider } from "@/contexts/ActivityLogContext";
import { ErrorBoundary } from "@/components/error-boundary";

export const metadata: Metadata = {
  title: brandName(),
  description: `${brandOsName()} — ERP terintegrasi untuk operasional bisnis`,
  icons: {
    icon: "/brand/favicon-64.png",
    apple: "/brand/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // ThemeScript mutates data-theme + brand CSS vars on <html> before React
    // hydrates; suppress the expected attribute mismatch (same pattern as next-themes).
    <html lang="id" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body suppressHydrationWarning>
        <ErrorBoundary>
          <ThemeProvider>
            <QueryProvider>
              <ActivityLogProvider>
                <ToastProvider>{children}</ToastProvider>
              </ActivityLogProvider>
            </QueryProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
