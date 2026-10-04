"use client";

import { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isStaleClientBundleError } from "@/lib/client-bundle-error";

const CHUNK_RELOAD_KEY = "arkiv:stale-bundle-reload";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    if (typeof window === "undefined" || !isStaleClientBundleError(error)) return;
    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      window.location.reload();
    } catch {
      // sessionStorage bisa diblokir
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    // Muat ulang penuh: pohon React yang crash tidak bisa dipercaya untuk navigasi klien.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/dashboard";
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Terjadi Kesalahan
            </h2>
            
            <p className="text-gray-600 mb-6">
              Maaf, telah terjadi kesalahan yang tidak terduga. 
              Tim kami telah diberitahu tentang masalah ini.
            </p>

            {this.state.error && (
              <div className="bg-gray-100 rounded p-4 mb-6 text-left overflow-auto">
                <p className="text-sm font-mono text-red-600">
                  {this.state.error.name}: {this.state.error.message}
                </p>
                {process.env.NODE_ENV === "development" && this.state.error.stack ? (
                  <pre className="mt-2 text-xs text-gray-600 overflow-x-auto">
                    {this.state.error.stack}
                  </pre>
                ) : null}
              </div>
            )}
            
            <div className="flex gap-3 justify-center">
              <Button onClick={this.handleReload} variant="outline" className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Muat Ulang
              </Button>
              
              <Button onClick={this.handleGoHome} className="gap-2">
                <Home className="w-4 h-4" />
                Ke Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
