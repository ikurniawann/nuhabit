import { router } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { normalizePhoneInput, requestOtp, verifyOtp } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { Spacing } from '@/constants/theme';

/**
 * Login portal member 2 langkah (EPIC-044 Fase A): nomor WhatsApp → kode OTP.
 * Jalur OTP identik dengan portal web (wa-gateway mandiri); di lokal, dev
 * bypass MEMBER_OTP_DEV_CODE tetap berlaku — isi kode dev apa pun (6 digit).
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitPhone() {
    setError(null);
    if (phone.replace(/\D/g, '').length < 8) {
      setError('Masukkan nomor WhatsApp yang valid');
      return;
    }
    setBusy(true);
    const res = await requestOtp(normalizePhoneInput(phone));
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Gagal mengirim kode');
      return;
    }
    setStep('otp');
  }

  async function submitCode() {
    setError(null);
    setBusy(true);
    const res = await verifyOtp(normalizePhoneInput(phone), code.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Kode salah');
      return;
    }
    if (!res.data?.token) {
      setError('Server tidak mengirim token sesi');
      return;
    }
    await signIn(res.data.token);
    router.replace('/(app)/home');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.avoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ThemedText type="subtitle">Portal Member</ThemedText>
          <ThemedText themeColor="textSecondary">
            {step === 'phone'
              ? 'Masukkan nomor WhatsApp terdaftar untuk masuk.'
              : `Kode OTP dikirim via WhatsApp ke ${phone}.`}
          </ThemedText>

          {step === 'phone' ? (
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="08xxxxxxxxxx"
              placeholderTextColor="#888"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoFocus
            />
          ) : (
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={code}
              onChangeText={setCode}
              placeholder="6 digit kode"
              placeholderTextColor="#888"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
            />
          )}

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
            ]}
            onPress={step === 'phone' ? submitPhone : submitCode}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {step === 'phone' ? 'Kirim Kode' : 'Masuk'}
              </Text>
            )}
          </Pressable>

          {step === 'otp' && !busy ? (
            <Pressable onPress={() => { setStep('phone'); setCode(''); setError(null); }}>
              <ThemedText type="small" themeColor="textSecondary">
                Ganti nomor / kirim ulang
              </ThemedText>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  avoid: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.two,
    justifyContent: 'center',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#666',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: '#fff',
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  codeInput: {
    letterSpacing: 8,
    textAlign: 'center',
    fontSize: 22,
  },
  error: { color: '#ff6b6b' },
  button: {
    backgroundColor: '#7c5cff',
    borderRadius: 12,
    paddingVertical: Spacing.two + 2,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
