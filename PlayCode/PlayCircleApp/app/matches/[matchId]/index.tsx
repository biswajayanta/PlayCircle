import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { MatchDetail } from '../../../lib/types';

function teamNames(match: MatchDetail, team: number): string {
  return match.participants
    .filter((p) => p.team === team)
    .map((p) => p.display_name)
    .join(' & ');
}

export default function MatchScoreScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);

  const load = useCallback(async () => {
    if (!matchId) return;
    setError(null);
    try {
      const result = await api.get<MatchDetail>(`/matches/${matchId}`);
      setMatch(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : 'Could not reach the PlayCircle API.'
      );
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePoint(team: 1 | 2) {
    if (!matchId || scoring) return;
    setScoring(true);
    try {
      const updated = await api.post<MatchDetail>(`/matches/${matchId}/points`, { team });
      setMatch(updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to record point';
      showAlert('Could not record point', message);
    } finally {
      setScoring(false);
    }
  }

  async function handleUndo() {
    if (!matchId || scoring) return;
    setScoring(true);
    try {
      const updated = await api.post<MatchDetail>(`/matches/${matchId}/undo`);
      setMatch(updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Nothing to undo';
      showAlert('Could not undo', message);
    } finally {
      setScoring(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !match) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Match not found'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const isLive = match.status === 'in_progress';
  const isComplete = match.status === 'completed';
  const safeScore = {
    history: match.score?.history ?? [],
    team_1: match.score?.team_1 ?? 0,
    team_2: match.score?.team_2 ?? 0,
  };
  const winnerTeam =
    isComplete && safeScore.team_1 !== safeScore.team_2
      ? safeScore.team_1 > safeScore.team_2
        ? 1
        : 2
      : null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Live Score' }} />

      {isComplete && (
        <View style={styles.resultBanner}>
          <Text style={styles.resultText}>
            {winnerTeam ? `${teamNames(match, winnerTeam)} won!` : 'Match complete'}
          </Text>
        </View>
      )}

      <View style={styles.scoreRow}>
        <View style={styles.teamPanel}>
          <Text style={styles.teamName}>{teamNames(match, 1)}</Text>
          <Text style={styles.scoreNumber}>{safeScore.team_1}</Text>
          <Pressable
            style={[styles.pointButton, (!isLive || scoring) && styles.disabledButton]}
            onPress={() => handlePoint(1)}
            disabled={!isLive || scoring}
          >
            <Text style={styles.pointButtonText}>+1</Text>
          </Pressable>
        </View>

        <View style={styles.divider} />

        <View style={styles.teamPanel}>
          <Text style={styles.teamName}>{teamNames(match, 2)}</Text>
          <Text style={styles.scoreNumber}>{safeScore.team_2}</Text>
          <Pressable
            style={[styles.pointButton, (!isLive || scoring) && styles.disabledButton]}
            onPress={() => handlePoint(2)}
            disabled={!isLive || scoring}
          >
            <Text style={styles.pointButtonText}>+1</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={[styles.undoButton, (safeScore.history.length === 0 || scoring) && styles.disabledButton]}
        onPress={handleUndo}
        disabled={safeScore.history.length === 0 || scoring}
      >
        <Text style={styles.undoButtonText}>Undo last point</Text>
      </Pressable>

      <Text style={styles.rulesNote}>Pickleball · rally scoring to 11, win by 2</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 24,
  },
  resultBanner: {
    backgroundColor: '#1F6F50',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  resultText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  scoreRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    padding: 20,
    alignItems: 'center',
  },
  teamPanel: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
  },
  divider: {
    width: 1,
    height: 120,
    backgroundColor: '#E7ECE9',
  },
  teamName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
    textAlign: 'center',
    minHeight: 34,
  },
  scoreNumber: {
    fontSize: 56,
    fontWeight: '800',
    color: '#173A2E',
  },
  pointButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 999,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.4,
  },
  pointButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  undoButton: {
    marginTop: 20,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  rulesNote: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 12,
    color: '#8A968F',
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
});
