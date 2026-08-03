import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { api, ApiError } from '../../../lib/api';
import { GameReport } from '../../../lib/types';

export default function GameReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<GameReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const result = await api.get<GameReport>(`/games/${id}/report`);
      setReport(result);
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
      <Stack.Screen options={{ title: 'Game Report' }} />

      <View style={styles.headerCard}>
        <Text style={styles.venueName}>{report.venue_name}</Text>
        <Text style={styles.headerMeta}>
          {new Date(report.scheduled_at).toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          · {report.status}
        </Text>
        <Text style={styles.spendValue}>₹{Number(report.total_expenses).toFixed(2)} total spent</Text>
      </View>

      <Text style={styles.sectionTitle}>Matches ({report.matches.length})</Text>
      {report.matches.length === 0 ? (
        <Text style={styles.emptyText}>No matches recorded for this game yet.</Text>
      ) : (
        report.matches.map((m) => (
          <View key={m.match_id} style={styles.matchCard}>
            <View style={styles.matchHeader}>
              <Text style={styles.matchFormat}>{m.format}</Text>
              <Text style={styles.matchStatus}>{m.status}</Text>
            </View>

            <View style={styles.teamsRow}>
              <View style={styles.teamBlock}>
                <Text
                  style={[
                    styles.teamPlayers,
                    m.winning_team && m.team_1_players.every((p) => m.winning_team!.includes(p)) &&
                      styles.winningTeamText,
                  ]}
                >
                  {m.team_1_players.join(' & ')}
                </Text>
                <Text style={styles.teamScore}>{m.team_1_score}</Text>
              </View>
              <Text style={styles.vsText}>vs</Text>
              <View style={styles.teamBlock}>
                <Text
                  style={[
                    styles.teamPlayers,
                    m.winning_team && m.team_2_players.every((p) => m.winning_team!.includes(p)) &&
                      styles.winningTeamText,
                  ]}
                >
                  {m.team_2_players.join(' & ')}
                </Text>
                <Text style={styles.teamScore}>{m.team_2_score}</Text>
              </View>
            </View>

            {m.winning_team && (
              <Text style={styles.winnerLine}>🏆 {m.winning_team.join(' & ')} won</Text>
            )}
          </View>
        ))
      )}
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
  headerCard: {
    backgroundColor: '#1F6F50',
    borderRadius: 12,
    padding: 18,
    marginBottom: 20,
  },
  venueName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  headerMeta: {
    color: '#D9EDE3',
    fontSize: 13,
    marginTop: 4,
    textTransform: 'capitalize',
  },
  spendValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#173A2E',
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 13,
    color: '#8A968F',
  },
  matchCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  matchFormat: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F6F50',
    textTransform: 'capitalize',
  },
  matchStatus: {
    fontSize: 12,
    color: '#8A968F',
    textTransform: 'capitalize',
  },
  teamsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamBlock: {
    flex: 1,
    alignItems: 'center',
  },
  teamPlayers: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
    textAlign: 'center',
  },
  winningTeamText: {
    color: '#1F6F50',
  },
  teamScore: {
    fontSize: 22,
    fontWeight: '800',
    color: '#173A2E',
    marginTop: 4,
  },
  vsText: {
    fontSize: 12,
    color: '#8A968F',
    marginHorizontal: 8,
  },
  winnerLine: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#1F6F50',
    marginTop: 10,
  },
});
