import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { GameDetail, MatchDetail, Sport } from '../../../lib/types';

type TeamAssignment = Record<string, 1 | 2 | undefined>;
type MatchFormat = 'singles' | 'doubles';

export default function NewMatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [sport, setSport] = useState<Sport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<MatchFormat>('doubles');
  const [assignments, setAssignments] = useState<TeamAssignment>({});
  const [starting, setStarting] = useState(false);
  const [pointsToWinInput, setPointsToWinInput] = useState('');
  const [maxBoardsInput, setMaxBoardsInput] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [gameResult, sportsResult] = await Promise.all([
        api.get<GameDetail>(`/games/${id}`),
        api.get<Sport[]>('/sports'),
      ]);
      setGame(gameResult);
      const matchedSport = sportsResult.find((s) => s.id === gameResult.sport_id) ?? null;
      setSport(matchedSport);
      const defaultWinScore = matchedSport?.scoring_config?.win_score;
      if (typeof defaultWinScore === 'number') {
        setPointsToWinInput(String(defaultWinScore));
      }
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

  function changeFormat(next: MatchFormat) {
    // Switching formats changes how many players each team needs, so a
    // previous partial assignment could become invalid — clearest to just
    // start the selection over.
    setFormat(next);
    setAssignments({});
  }

  const confirmedParticipants = (game?.participants ?? []).filter(
    (p) => p.status === 'confirmed'
  );
  const perTeamNeeded = format === 'singles' ? 1 : 2;
  const team1Count = Object.values(assignments).filter((t) => t === 1).length;
  const team2Count = Object.values(assignments).filter((t) => t === 2).length;
  const readyToStart = team1Count === perTeamNeeded && team2Count === perTeamNeeded;

  // A sport gets configurable points/boards if it has a plain target score
  // with no margin or serve-rule concept (Carrom-style race-to-target) —
  // Pickleball's config has win_by, so it's excluded without hardcoding
  // sport names, meaning any future sport shaped like Carrom gets this for
  // free too.
  const cfg = sport?.scoring_config;
  const showAdvancedConfig = !!cfg && 'win_score' in cfg && !('win_by' in cfg);

  async function handleStart() {
    if (!id || !readyToStart) return;
    setStarting(true);
    try {
      const participants = Object.entries(assignments)
        .filter(([, team]) => team !== undefined)
        .map(([user_id, team]) => ({ user_id, team }));

      const payload: {
        format: MatchFormat;
        participants: typeof participants;
        points_to_win?: number;
        max_boards?: number;
      } = { format, participants };

      if (showAdvancedConfig) {
        const parsedPoints = parseInt(pointsToWinInput, 10);
        if (Number.isInteger(parsedPoints) && parsedPoints >= 1) {
          payload.points_to_win = parsedPoints;
        }
        if (maxBoardsInput.trim()) {
          const parsedBoards = parseInt(maxBoardsInput, 10);
          if (Number.isInteger(parsedBoards) && parsedBoards >= 1) {
            payload.max_boards = parsedBoards;
          }
        }
      }

      const match = await api.post<MatchDetail>(`/games/${id}/matches`, payload);
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

      <View style={styles.formatRow}>
        <Pressable
          style={[styles.formatButton, format === 'singles' && styles.formatButtonSelected]}
          onPress={() => changeFormat('singles')}
        >
          <Text
            style={[styles.formatButtonText, format === 'singles' && styles.formatButtonTextSelected]}
          >
            Singles
          </Text>
        </Pressable>
        <Pressable
          style={[styles.formatButton, format === 'doubles' && styles.formatButtonSelected]}
          onPress={() => changeFormat('doubles')}
        >
          <Text
            style={[styles.formatButtonText, format === 'doubles' && styles.formatButtonTextSelected]}
          >
            Doubles
          </Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        {format === 'singles'
          ? 'Tap a player, then tap Team 1 or Team 2 for each (1 per team).'
          : 'Tap Team 1 or Team 2 for each player (2 per team).'}
      </Text>

      {showAdvancedConfig && (
        <View style={styles.configRow}>
          <View style={styles.configField}>
            <Text style={styles.configLabel}>Points to win</Text>
            <TextInput
              style={styles.configInput}
              keyboardType="number-pad"
              value={pointsToWinInput}
              onChangeText={setPointsToWinInput}
              placeholder="25"
              placeholderTextColor="#9AA69E"
            />
          </View>
          <View style={styles.configField}>
            <Text style={styles.configLabel}>Max boards (optional)</Text>
            <TextInput
              style={styles.configInput}
              keyboardType="number-pad"
              value={maxBoardsInput}
              onChangeText={setMaxBoardsInput}
              placeholder="Unlimited"
              placeholderTextColor="#9AA69E"
            />
          </View>
        </View>
      )}

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
  formatRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  formatButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  formatButtonSelected: {
    backgroundColor: '#1F6F50',
    borderColor: '#1F6F50',
  },
  formatButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#173A2E',
  },
  formatButtonTextSelected: {
    color: '#fff',
  },
  hint: {
    fontSize: 13,
    color: '#6B7A73',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  configRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  configField: {
    flex: 1,
  },
  configLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7A73',
    marginBottom: 4,
  },
  configInput: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
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
