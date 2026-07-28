import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { GameDetail, MatchDetail } from '../../../lib/types';

type TeamAssignment = Record<string, 1 | 2 | undefined>;

export default function NewMatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<TeamAssignment>({});
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const result = await api.get<GameDetail>(`/games/${id}`);
      setGame(result);
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

  function setTeam(userId: string, team: 1 | 2) {
    setAssignments((prev) => ({ ...prev, [userId]: prev[userId] === team ? undefined : team }));
  }

  const confirmedParticipants = (game?.participants ?? []).filter(
    (p) => p.status === 'confirmed'
  );
  const perTeamNeeded = game?.format === 'singles' ? 1 : 2;
  const team1Count = Object.values(assignments).filter((t) => t === 1).length;
  const team2Count = Object.values(assignments).filter((t) => t === 2).length;
  const readyToStart = team1Count === perTeamNeeded && team2Count === perTeamNeeded;

  async function handleStart() {
    if (!id || !readyToStart) return;
    setStarting(true);
    try {
      const participants = Object.entries(assignments)
        .filter(([, team]) => team !== undefined)
        .map(([user_id, team]) => ({ user_id, team }));
      const match = await api.post<MatchDetail>(`/games/${id}/matches`, { participants });
      router.replace(`/matches/${match.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to start match';
      showAlert('Could not start match', message);
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !game) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Game not found'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'New Match' }} />
      <Text style={styles.hint}>
        {game.format === 'singles'
          ? 'Tap a player, then tap Team 1 or Team 2 for each (1 per team).'
          : 'Tap Team 1 or Team 2 for each player (2 per team).'}
      </Text>

      <FlatList
        data={confirmedParticipants}
        keyExtractor={(p) => p.user_id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const assigned = assignments[item.user_id];
          return (
            <View style={styles.playerRow}>
              <Text style={styles.playerName}>{item.display_name}</Text>
              <View style={styles.teamButtons}>
                <Pressable
                  style={[styles.teamButton, assigned === 1 && styles.teamButtonSelected]}
                  onPress={() => setTeam(item.user_id, 1)}
                >
                  <Text
                    style={[
                      styles.teamButtonText,
                      assigned === 1 && styles.teamButtonTextSelected,
                    ]}
                  >
                    Team 1
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.teamButton, assigned === 2 && styles.teamButtonSelected]}
                  onPress={() => setTeam(item.user_id, 2)}
                >
                  <Text
                    style={[
                      styles.teamButtonText,
                      assigned === 2 && styles.teamButtonTextSelected,
                    ]}
                  >
                    Team 2
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <Text style={styles.countText}>
          Team 1: {team1Count}/{perTeamNeeded} · Team 2: {team2Count}/{perTeamNeeded}
        </Text>
        <Pressable
          style={[styles.startButton, (!readyToStart || starting) && styles.disabledButton]}
          onPress={handleStart}
          disabled={!readyToStart || starting}
        >
          <Text style={styles.startButtonText}>{starting ? 'Starting...' : 'Start Match'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 24,
  },
  hint: {
    fontSize: 13,
    color: '#6B7A73',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  listContent: {
    padding: 16,
  },
  playerRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#173A2E',
  },
  teamButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  teamButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
  },
  teamButtonSelected: {
    backgroundColor: '#1F6F50',
    borderColor: '#1F6F50',
  },
  teamButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  teamButtonTextSelected: {
    color: '#fff',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E7ECE9',
    backgroundColor: '#fff',
  },
  countText: {
    fontSize: 13,
    color: '#6B7A73',
    marginBottom: 10,
    textAlign: 'center',
  },
  startButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  startButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
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
