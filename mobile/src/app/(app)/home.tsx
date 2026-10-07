import { Redirect, router } from 'expo-router';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useMemberData } from '@/hooks/use-member-data';
import {
  angka,
  formatIdr,
  tanggal,
  tierProgressPercent,
  txnLabel,
  txnSignedArk,
} from '@/lib/loyalty';
import { Spacing } from '@/constants/theme';

/**
 * Beranda mobile (EPIC-044 Fase B): kartu saldo ARK/XP/tier dengan progres
 * antar-tier + riwayat koin & belanja. Riwayat gagal tidak mematikan portal
 * (paritas perilaku adapter Nox dashboard).
 */
export default function HomeScreen() {
  const { signOut } = useAuth();
  const { state, reload } = useMemberData();

  const onSignOut = useCallback(() => {
    signOut().then(() => router.replace('/login'));
  }, [signOut]);

  if (state.status === 'unauthenticated') {
    return <Redirect href="/login" />;
  }

  if (state.status === 'loading') {
    return (
      <ThemedView style={[styles.container, styles.center]}>
        <ThemedText themeColor="textSecondary">Memuat…</ThemedText>
      </ThemedView>
    );
  }

  if (state.status === 'error') {
    return (
      <ThemedView style={[styles.container, styles.center]}>
        <ThemedText>Gagal memuat data.</ThemedText>
        <Pressable onPress={reload} style={styles.retry}>
          <ThemedText themeColor="textSecondary">Coba lagi</ThemedText>
        </Pressable>
        <Pressable onPress={onSignOut}>
          <ThemedText themeColor="textSecondary">Keluar</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const { member, wallet, orders, historyError } = state;
  const saldoArk = Math.round(
    member.ark_coin_balance / Math.max(1, Number(member.ark_rate) || 1000)
  );
  const progress = tierProgressPercent(
    member.total_xp,
    member.tiers ?? [],
    member.tier?.code,
    Boolean(member.next_tier)
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={reload} />
          }
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <ThemedText type="subtitle">
              Halo{member.profile.name ? `, ${member.profile.name.split(' ')[0]}` : ''}
            </ThemedText>
            <Pressable onPress={onSignOut}>
              <ThemedText type="small" themeColor="textSecondary">
                Keluar
              </ThemedText>
            </Pressable>
          </View>

          {/* Kartu saldo ARK */}
          <ThemedView type="backgroundElement" style={[styles.card, styles.cardHero]}>
            <ThemedText themeColor="textSecondary" type="small">
              Saldo ARK Coin
            </ThemedText>
            <ThemedText type="subtitle">{angka(saldoArk)} ARK</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">
              ≈ {formatIdr(member.ark_coin_balance)}
            </ThemedText>
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <ThemedText type="small">{member.tier?.name ?? 'Regular'}</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {angka(member.visit_count)} kunjungan
              </ThemedText>
            </View>
          </ThemedView>

          {/* Kartu XP + progres tier */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText themeColor="textSecondary" type="small">
              Total XP (seumur hidup)
            </ThemedText>
            <ThemedText type="subtitle">{angka(member.total_xp)} XP</ThemedText>
            {member.next_tier ? (
              <>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${progress ?? 0}%` },
                    ]}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {angka(member.next_tier.xp_needed)} XP lagi menuju{' '}
                  {member.next_tier.name}
                </ThemedText>
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Anda di tier tertinggi 🎉
              </ThemedText>
            )}
          </ThemedView>

          {/* Riwayat koin */}
          <ThemedText type="subtitle">Transaksi Koin</ThemedText>
          {historyError ? (
            <ThemedText themeColor="textSecondary" type="small">
              Riwayat gagal dimuat — tarik ke bawah untuk mencoba lagi.
            </ThemedText>
          ) : wallet.length === 0 ? (
            <ThemedText themeColor="textSecondary" type="small">
              Belum ada transaksi koin.
            </ThemedText>
          ) : (
            wallet.slice(0, 10).map((txn) => (
              <View key={txn.id} style={styles.txnRow}>
                <View style={styles.txnMeta}>
                  <ThemedText type="default">{txnLabel(txn.type)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {tanggal(txn.createdAt)}
                  </ThemedText>
                </View>
                <ThemedText
                  type="default"
                  style={{
                    color: txnSignedArk(txn) >= 0 ? '#4ade80' : '#ff6b6b',
                  }}
                >
                  {txnSignedArk(txn) >= 0 ? '+' : ''}
                  {angka(txnSignedArk(txn))} ARK
                </ThemedText>
              </View>
            ))
          )}

          {/* Riwayat belanja */}
          <ThemedText type="subtitle">Riwayat Belanja</ThemedText>
          {!historyError && orders.length === 0 ? (
            <ThemedText themeColor="textSecondary" type="small">
              Belum ada pembelian.
            </ThemedText>
          ) : (
            orders.slice(0, 10).map((order) => (
              <View key={order.id} style={styles.txnRow}>
                <View style={styles.txnMeta}>
                  <ThemedText type="default">{order.orderNumber}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {tanggal(order.createdAt)}
                  </ThemedText>
                </View>
                <ThemedText type="default">
                  {formatIdr(order.totalIdr)}
                  {order.paidWithArk && order.arkDisplay !== null
                    ? ` / ${angka(order.arkDisplay)} ARK`
                    : ''}
                </ThemedText>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  card: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardHero: { gap: Spacing.half },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  badge: {
    backgroundColor: '#7c5cff33',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(128,128,128,0.25)',
    overflow: 'hidden',
    marginTop: Spacing.one,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7c5cff',
    borderRadius: 999,
  },
  retry: { paddingVertical: Spacing.one },
  txnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  txnMeta: { gap: 2 },
});
