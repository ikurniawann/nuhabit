import * as SecureStore from "expo-secure-store";

/**
 * Penyimpanan token sesi member (EPIC-044 Fase A).
 *
 * Token = token mentah dari `POST /api/member-portal/verify` (klien app
 * mengirim header `x-app-client: 1`). Disimpan di SecureStore — iOS Keychain /
 * Android Keystore — BUKAN AsyncStorage biasa (acceptance criteria epic).
 *
 * Catatan: SecureStore di web fallback ke localStorage; target utama app
 * adalah iOS/Android native.
 */

const TOKEN_KEY = "member_session_token";

export async function saveSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
