import { Stack, Redirect } from 'expo-router';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';

import { useAuth } from '@/hooks/use-auth';

/**
 * Grup layar yang butuh sesi member (EPIC-044 Fase A).
 * Guard tunggal di layout: guest → login; loading → tetap di splash.
 */
export default function AppGroupLayout() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;
  if (status === 'guest') return <Redirect href="/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="home" />
    </Stack>
  );
}
