import { router } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { Spacing } from '@/constants/theme';
import { login } from '@/lib/api';

/** The API answers 403 for an account that has no password yet. */
const NO_PASSWORD_STATUS = 403;

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitLogin() {
    setError(null);
    if (!username.trim()) {
      setError('Enter your WhatsApp number or email.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    const res = await login(username.trim(), password);
    setBusy(false);
    if (!res.ok) {
      const message = res.error ?? 'Could not sign in. Try again.';
      setError(
        res.status === NO_PASSWORD_STATUS ? `${message} The front desk at any NüHabit studio can set one for you.` : message
      );
      return;
    }
    if (!res.data?.token) {
      setError('The server did not return a session token.');
      return;
    }
    await signIn(res.data.token);
    router.replace('/(app)/home');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.avoid} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ThemedText type="subtitle">Member Portal</ThemedText>
          <ThemedText themeColor="textSecondary">Sign in with your WhatsApp number or email and your password.</ThemedText>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="WhatsApp number or email"
            placeholderTextColor="#888"
            autoCapitalize="none"
            autoComplete="username"
            autoFocus
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#888"
            autoComplete="current-password"
            secureTextEntry
          />
          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={submitLogin}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  avoid: { flex: 1, padding: Spacing.four, gap: Spacing.two, justifyContent: 'center' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#666',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: '#fff',
    backgroundColor: 'rgba(128,128,128,0.12)',
    marginTop: Spacing.one,
  },
  error: { color: '#ff6b6b', marginTop: Spacing.one },
  button: { backgroundColor: '#7c5cff', borderRadius: 12, paddingVertical: Spacing.two + 2, alignItems: 'center', marginTop: Spacing.one },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
