import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '../../../lib/api';
import { CircleLeaderboard, CircleReport } from '../../../lib/types';

export default function CircleReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<CircleReport | null>(null);
  const [leaderboard, setLeaderboard] = useState<CircleLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [reportResult, leaderboardResult] = await Promise.all([
        api.get<CircleReport>(`/circles/${id}/report`),
        api.get<CircleLeaderboard>(`/circles/${id}/leaderboard`),
      ]);
      setReport(reportResult);
      setLeaderboard(leaderboardResult);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : 'Could not reach the PlayCircle API.'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !report) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Report unavailable'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `${report.circle_name} · Report` }} />

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{report.games_completed}</Text>
          <Text style={styles.statLabel}>Played</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{report.games_upcoming}</Text>
          <Text style={styles.statLabel}>Upcoming</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{report.games_cancelled}</Text>
          <Text style={styles.statLabel}>Cancelled</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{report.member_count}</Text>
          <Text style={styles.statLabel}>Members</Text>
        </View>
      </View>

      {report.tournaments_total > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tournaments</Text>
          <View style={styles.tournamentStatsRow}>
            <View style={styles.tournamentStatItem}>
              <Text style={styles.tournamentStatValue}>{report.tournaments_completed}</Text>
              <Text style={styles.tournamentStatLabel}>Completed</Text>
            </View>
            <View style={styles.tournamentStatItem}>
              <Text style={styles.tournamentStatValue}>{report.tournaments_in_progress}</Text>
              <Text style={styles.tournamentStatLabel}>In progress</Text>
            </View>
            <View style={styles.tournamentStatItem}>
              <Text style={styles.tournamentStatValue}>{report.tournaments_setting_up}</Text>
              <Text style={styles.tournamentStatLabel}>Setting up</Text>
            </View>
            <View style={styles.tournamentStatItem}>
              <Text style={styles.tournamentStatValue}>{report.tournaments_total}</Text>
              <Text style={styles.tournamentStatLabel}>Total</Text>
            </View>
          </View>
        </View>
      )}

      <View style={styles.spendCard}>
        <Text style={styles.spendLabel}>Total spent across all games</Text>
        <Text style={styles.spendValue}>₹{Number(report.total_spent).toFixed(2)}</Text>
        <Pressable
          style={styles.ledgerLink}
          onPress={() => router.push(`/circles/${id}/ledger`)}
        >
          <Text style={styles.ledgerLinkText}>View Circle Ledger →</Text>
        </Pressable>
      </View>

      {report.venues.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Venues used</Text>
          {report.venues.map((v) => (
            <View key={v.venue_name} style={styles.venueRow}>
              <Text style={styles.venueName}>{v.venue_name}</Text>
              <Text style={styles.venueCount}>
                {v.games_count} {v.games_count === 1 ? 'game' : 'games'}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Leaderboard</Text>
        {!leaderboard || leaderboard.entries.length === 0 ? (
          <Text style={styles.emptyText}>No completed matches yet.</Text>
        ) : (
          leaderboard.entries.map((entry, i) => (
            <View key={entry.user_id} style={styles.leaderRow}>
              <Text style={styles.leaderRank}>{i + 1}</Text>
              <View style={styles.leaderInfo}>
                <Text style={styles.leaderName}>{entry.display_name}</Text>
                <Text style={styles.leaderRecord}>
                  {entry.wins}W · {entry.losses}L · {entry.matches_played} played
                </Text>
              </View>
              <Text style={styles.leaderWinRate}>{entry.win_rate}%</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 24,
  },
  errorText: {
    textAlign: 'center',
    color: '#B3261E',
    fontSize: 14,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    flexBasis: '47%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#173A2E',
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7A73',
    marginTop: 2,
  },
  tournamentStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tournamentStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  tournamentStatValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#C9971F',
  },
  tournamentStatLabel: {
    fontSize: 11,
    color: '#6B7A73',
    marginTop: 2,
    textAlign: 'center',
  },
  spendCard: {
    backgroundColor: '#1F6F50',
    borderRadius: 12,
    padding: 18,
    marginBottom: 20,
  },
  spendLabel: {
    color: '#D9EDE3',
    fontSize: 13,
  },
  spendValue: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    marginTop: 4,
  },
  ledgerLink: {
    marginTop: 12,
  },
  ledgerLinkText: {
    color: '#D9EDE3',
    fontSize: 13,
    fontWeight: '700',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#173A2E',
    marginBottom: 10,
  },
  venueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  venueName: {
    fontSize: 14,
    color: '#173A2E',
  },
  venueCount: {
    fontSize: 13,
    color: '#6B7A73',
  },
  emptyText: {
    fontSize: 13,
    color: '#8A968F',
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  leaderRank: {
    width: 24,
    fontSize: 14,
    fontWeight: '700',
    color: '#8A968F',
  },
  leaderInfo: {
    flex: 1,
  },
  leaderName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#173A2E',
  },
  leaderRecord: {
    fontSize: 12,
    color: '#6B7A73',
    marginTop: 1,
  },
  leaderWinRate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F6F50',
  },
});
