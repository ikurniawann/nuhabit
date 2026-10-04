'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

function subscribeConnectivity(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Status koneksi browser; `wasOffline` tetap true setelah sempat offline sampai di-reset pemanggil. */
export function usePosOnline() {
  const isOnline = useSyncExternalStore(subscribeConnectivity, () => navigator.onLine, () => true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOffline = () => setWasOffline(true);
    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, []);

  return { isOnline, wasOffline, setWasOffline };
}
