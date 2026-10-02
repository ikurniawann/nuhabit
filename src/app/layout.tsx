import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { brandName, brandOsName } from "@/lib/branding";
import "quill/dist/quill.snow.css";
import QueryProvider from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeScript } from "@/components/providers/theme-script";
import { ToastProvider } from "@/components/providers/toast-provider";
import { ActivityLogProvider } from "@/contexts/ActivityLogContext";
import { ErrorBoundary } from "@/components/error-boundary";

// Font merek NüHabit (DESIGN.md §3). File variable font (OFL) disimpan di repo
// supaya build Docker tidak bergantung pada unduhan Google Fonts.
const manrope = localFont({
  src: "./fonts/manrope-latin-variable.woff2",
  weight: "200 800",
  variable: "--font-manrope",
  display: "swap",
});
const outfit = localFont({
  src: "./fonts/outfit-latin-variable.woff2",
  weight: "100 900",
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: brandName(),
  description: `${brandOsName()} — ERP terintegrasi untuk operasional bisnis`,
  icons: {
    icon: "/favicon.svg?v=nuhabit-nu",
    apple: "/brand/nuhabit-icon-180.png",
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
    <html lang="id" className={`${manrope.variable} ${outfit.variable}`} suppressHydrationWarning>
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
