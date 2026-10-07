import { Redirect } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { ThemedView } from '@/components/themed-view';

/**
 * Gate awal app: arahkan sesuai state sesi (EPIC-044 Fase A).
 * loading = layar kosong di belakang splash; keputusan pertama menyembunyikan
 * splash supaya tidak kedip dua kali.
 */
export default function Index() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return <ThemedView style={{ flex: 1 }} />;
  if (status === 'authed') return <Redirect href="/(app)/home" />;
  return <Redirect href="/login" />;
}
