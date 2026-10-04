'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  queueOfflineOrder,
  getOfflineQueue,
  getPendingQueue,
  updateQueueItem,
  removeFromQueue,
  type OfflineOrderPayload,
  type OfflineOrderRequest,
} from '@/lib/pos-db';
import { createOrder, createSplitOrder } from '@/lib/pos-api';
import {
  AUTO_SYNC_INTERVAL_MS,
  AUTO_SYNC_ONLINE_DELAY_MS,
  classifySyncFailure,
  shouldAutoSync,
} from '@/lib/pos/offline-sync';

/**
 * Antrian transaksi offline (IndexedDB) + sinkron ke server.
 *
 * - Gagal karena jaringan → item TETAP pending dan dicoba lagi otomatis
 *   (event `online` + interval). Ditolak server → status `failed`, kasir
 *   memutuskan: coba lagi atau buang.
 * - Item yang tersangkut `syncing` (tab ditutup di tengah sinkron)
 *   dipulihkan ke pending saat hook dipasang.
 */
export function usePosOfflineQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [queueItems, setQueueItems] = useState<OfflineOrderRequest[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgress = useRef(false);
  const pendingRef = useRef(0);

  const refreshCount = useCallback(async () => {
    const all = await getOfflineQueue();
    const open = all
      .filter((i) => i.status !== 'completed')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const pending = open.filter((i) => i.status === 'pending');
    pendingRef.current = pending.length;
    setQueueItems(open);
    setPendingCount(pending.length);
    setFailedCount(open.filter((i) => i.status === 'failed').length);
    return pending;
  }, []);

  // Enqueue a single order or split order payload
  const enqueue = useCallback(async (payload: object, type: 'order' | 'split') => {
    const id = await queueOfflineOrder({ ...payload, _offlineType: type } as OfflineOrderPayload);
    await refreshCount();
    return id;
  }, [refreshCount]);

  // Sync all pending items (call when online)
  const syncQueue = useCallback(async () => {
    if (syncInProgress.current) return { synced: 0, failed: 0 };
    syncInProgress.current = true;
    setIsSyncing(true);

    let synced = 0;
    let failed = 0;
    const pending = await getPendingQueue();

    for (const item of pending) {
      try {
        await updateQueueItem({ ...item, status: 'syncing' });
        const payload = item.orderPayload;
        const res: { success: boolean; error?: string } =
          payload._offlineType === 'split' ? await createSplitOrder(payload) : await createOrder(payload);

        if (res.success) {
          await removeFromQueue(item.queueId!);
          synced++;
        } else {
          await updateQueueItem({
            ...item,
            status: 'failed',
            errorMessage: res.error || 'Sync failed',
            retryCount: item.retryCount + 1,
          });
          failed++;
        }
      } catch (e: unknown) {
        const kind = classifySyncFailure(e);
        await updateQueueItem({
          ...item,
          status: kind === 'retry' ? 'pending' : 'failed',
          errorMessage: e instanceof Error && e.message ? e.message : 'Network error',
          retryCount: item.retryCount + 1,
        });
        if (kind === 'retry') {
          // Jaringan masih putus — sisa antrian pasti gagal juga, jangan dihajar.
          break;
        }
        failed++;
      }
    }

    await refreshCount();
    setIsSyncing(false);
    syncInProgress.current = false;
    return { synced, failed };
  }, [refreshCount]);

  // Fetch failed items to retry
  const getFailedItems = useCallback(async () => {
    const all = await getOfflineQueue();
    return all.filter((i) => i.status === 'failed');
  }, []);

  /** Kembalikan semua item `failed` ke pending lalu sinkron sekarang. */
  const retryFailed = useCallback(async () => {
    const all = await getOfflineQueue();
    for (const item of all) {
      if (item.status === 'failed') {
        await updateQueueItem({ ...item, status: 'pending', errorMessage: undefined });
      }
    }
    await refreshCount();
    return syncQueue();
  }, [refreshCount, syncQueue]);

  /** Buang satu item (transaksi yang memang tidak boleh masuk server). */
  const discardItem = useCallback(async (queueId: number) => {
    await removeFromQueue(queueId);
    await refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getOfflineQueue();
      for (const item of all) {
        if (item.status === 'syncing') {
          await updateQueueItem({ ...item, status: 'pending' });
        }
      }
      if (!cancelled) await refreshCount();
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshCount]);

  /* Auto-sync: begitu koneksi pulih + interval selama antrian belum kosong. */
  useEffect(() => {
    const run = async () => {
      if (
        !shouldAutoSync({
          online: navigator.onLine,
          pendingCount: pendingRef.current,
          syncing: syncInProgress.current,
        })
      ) {
        return;
      }
      const { synced, failed } = await syncQueue();
      if (synced > 0) toast.success(`${synced} transaksi offline terkirim ke server`);
      if (failed > 0) toast.error(`${failed} transaksi offline ditolak server — buka antrian offline`);
    };
    let onlineTimer: number | undefined;
    const onOnline = () => {
      window.clearTimeout(onlineTimer);
      onlineTimer = window.setTimeout(() => void run(), AUTO_SYNC_ONLINE_DELAY_MS);
    };
    window.addEventListener('online', onOnline);
    const interval = window.setInterval(() => void run(), AUTO_SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearTimeout(onlineTimer);
      window.clearInterval(interval);
    };
  }, [syncQueue]);

  return {
    pendingCount,
    failedCount,
    queueItems,
    isSyncing,
    enqueue,
    syncQueue,
    retryFailed,
    discardItem,
    getFailedItems,
    refreshCount,
  };
}
