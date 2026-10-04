'use client';

import { useRef, useEffect, useEffectEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Wifi, AlertCircle } from 'lucide-react';

interface Props {
  open: boolean;
  input: string;
  searching: boolean;
  error: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function NFCModal({ open, input, searching, error, onInputChange, onSubmit, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const clearInput = useEffectEvent(() => onInputChange(''));

  // Buka: fokus ke input tersembunyi (reader NFC mengetik ke sana). Tutup: kosongkan.
  useEffect(() => {
    if (!open) {
      clearInput();
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tap Kartu Member NFC</DialogTitle>
        </DialogHeader>
        <div className="py-6 space-y-6 text-center">
          <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-amber-100 animate-ping opacity-40" />
            <div className="relative w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center">
              <Wifi className="w-8 h-8 text-white" />
            </div>
          </div>
          <div>
            <p className="text-base font-semibold text-gray-800">Dekatkan Kartu ke Reader NFC</p>
            <p className="text-sm text-gray-500 mt-1">Kartu akan otomatis terdeteksi</p>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input.trim()) onSubmit();
            }}
            className="opacity-0 absolute w-0 h-0 pointer-events-none"
            aria-hidden="true"
          />
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Atau masukkan ID kartu secara manual:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSubmit();
                }}
                placeholder="ID Pelanggan / Nomor HP"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                onClick={onSubmit}
                disabled={!input.trim() || searching}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
              >
                Cari
              </button>
            </div>
          </div>
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-left">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          {searching && (
            <div className="flex items-center justify-center gap-2 text-amber-600">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Mencari member...</span>
            </div>
          )}
          <button onClick={onCancel} className="w-full py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
            Batal
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
