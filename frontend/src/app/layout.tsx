import type { Metadata } from "next";
import { Manrope, Outfit } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
// After globals.css: pins the NüHabit tokens even when a build ships another globals.css.
import "./brand.css";
import { brandName, brandOsName } from "@/lib/branding";
import "quill/dist/quill.snow.css";
import QueryProvider from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeScript } from "@/components/providers/theme-script";
import { ActivityLogProvider } from "@/contexts/ActivityLogContext";
import { ErrorBoundary } from "@/components/error-boundary";

// Self-hosted at build time; brand.css puts them first in the font stacks.
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

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
    <html lang="id" className={`${outfit.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body suppressHydrationWarning>
        <ErrorBoundary>
          <ThemeProvider>
            <QueryProvider>
              <ActivityLogProvider>{children}</ActivityLogProvider>
              {/* Satu-satunya Toaster aplikasi; halaman cukup memanggil toast() dari sonner. */}
              <Toaster position="bottom-right" />
            </QueryProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
