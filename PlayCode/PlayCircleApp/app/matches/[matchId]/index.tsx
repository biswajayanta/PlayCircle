import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { MatchDetail } from '../../../lib/types';

function teamNames(match: MatchDetail, team: number): string {
  return match.participants
    .filter((p) => p.team === team)
    .map((p) => p.display_name)
    .join(' & ');
}

// Cosmetic only — the backend's scoring engine is the actual source of
// truth for rules. This just gives each sport a friendly one-line
// description under the scoreboard. Anything not listed here still works
// fine; it just falls back to showing the sport name alone.
const SPORT_RULES_BLURB: Record<string, string> = {
  pickleball: 'rally scoring to 11, win by 2',
  carrom: 'race to 25 points',
};

function formatRulesNote(match: MatchDetail): string {
  const label = match.sport_name.charAt(0).toUpperCase() + match.sport_name.slice(1);
  const cfg = match.score?.config;
  if (cfg?.points_to_win && cfg?.win_by) {
    // Set-based (Pickleball): margin-based win condition per set.
    const setsPart = cfg.num_sets ? `best of ${cfg.num_sets} sets, ` : '';
    return `${label} · ${setsPart}race to ${cfg.points_to_win}, win by ${cfg.win_by}`;
  }
  if (cfg?.points_to_win) {
    // Board-based (Carrom): plain race to a target, no margin.
    const boardsPart = cfg.max_boards ? `, best of ${cfg.max_boards} boards` : '';
    return `${label} · race to ${cfg.points_to_win}${boardsPart}`;
  }
  const blurb = SPORT_RULES_BLURB[match.sport_name.trim().toLowerCase()];
  return blurb ? `${label} · ${blurb}` : label;
}

export default function MatchScoreScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const [boardPointsInput, setBoardPointsInput] = useState('');
  const [concludeOpen, setConcludeOpen] = useState(false);
  const [concluding, setConcluding] = useState(false);

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

  async function handlePoint(team: 1 | 2, points: number = 1) {
    if (!matchId || scoring) return;
    setScoring(true);
    try {
      const updated = await api.post<MatchDetail>(`/matches/${matchId}/points`, { team, points });
      setMatch(updated);
      setBoardPointsInput('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to record point';
      showAlert('Could not record point', message);
    } finally {
      setScoring(false);
    }
  }

  async function handleConclude(outcome: 'cancelled' | 'draw' | 'winner') {
    if (!matchId || !match || concluding) return;
    setConcluding(true);
    try {
      let updated: MatchDetail;
      if (outcome === 'cancelled') {
        updated = await api.patch<MatchDetail>(`/matches/${matchId}/complete`, {
          status: 'abandoned',
        });
      } else {
        const t1 = safeScore.team_1;
        const t2 = safeScore.team_2;
        const leaderTeam = outcome === 'winner' ? (t1 > t2 ? 1 : 2) : null;
        const participants = match.participants.map((p) => ({
          user_id: p.user_id,
          points_scored: p.team === 1 ? t1 : t2,
          result: outcome === 'draw' ? 'draw' : p.team === leaderTeam ? 'win' : 'loss',
        }));
        updated = await api.patch<MatchDetail>(`/matches/${matchId}/complete`, {
          status: 'completed',
          participants,
        });
      }
      setMatch(updated);
      setConcludeOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to conclude match';
      showAlert('Could not conclude match', message);
    } finally {
      setConcluding(false);
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
    boardsPlayed: match.score?.boards_played,
    config: match.score?.config,
    sets: match.score?.sets,
    currentSetTeam1: match.score?.current_set_team_1,
    currentSetTeam2: match.score?.current_set_team_2,
  };
  // Board-based sports (Carrom) carry boards_played in their score state;
  // set-based sports (Pickleball) carry a sets array instead; plain
  // rally-based sports carry neither — this is how the screen tells them
  // apart without hardcoding a sport name check.
  const isBoardBased = safeScore.boardsPlayed !== undefined;
  const isSetBased = safeScore.sets !== undefined;
  const boardPoints = parseInt(boardPointsInput, 10);
  const boardPointsValid = Number.isInteger(boardPoints) && boardPoints >= 1;
  const canUndo = isSetBased
    ? (safeScore.currentSetTeam1 ?? 0) + (safeScore.currentSetTeam2 ?? 0) > 0 ||
      (safeScore.sets?.length ?? 0) > 0
    : safeScore.history.length > 0;

  const winnerTeam =
    isComplete && safeScore.team_1 !== safeScore.team_2
      ? safeScore.team_1 > safeScore.team_2
        ? 1
        : 2
      : null;
  const isDraw = isComplete && safeScore.team_1 === safeScore.team_2;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Live Score' }} />

      {isComplete && (
        <View style={styles.resultBanner}>
          <Text style={styles.resultText}>
            {isDraw ? "It's a draw" : winnerTeam ? `${teamNames(match, winnerTeam)} won!` : 'Match complete'}
          </Text>
        </View>
      )}

      <View style={styles.scoreRow}>
        <View style={styles.teamPanel}>
          <Text style={styles.teamName}>{teamNames(match, 1)}</Text>
          <Text style={styles.scoreNumber}>{safeScore.team_1}</Text>
          {isSetBased && <Text style={styles.setsWonLabel}>sets</Text>}
          {!isBoardBased && !isSetBased && (
            <Pressable
              style={[styles.pointButton, (!isLive || scoring) && styles.disabledButton]}
              onPress={() => handlePoint(1)}
              disabled={!isLive || scoring}
            >
              <Text style={styles.pointButtonText}>+1</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.teamPanel}>
          <Text style={styles.teamName}>{teamNames(match, 2)}</Text>
          <Text style={styles.scoreNumber}>{safeScore.team_2}</Text>
          {isSetBased && <Text style={styles.setsWonLabel}>sets</Text>}
          {!isBoardBased && !isSetBased && (
            <Pressable
              style={[styles.pointButton, (!isLive || scoring) && styles.disabledButton]}
              onPress={() => handlePoint(2)}
              disabled={!isLive || scoring}
            >
              <Text style={styles.pointButtonText}>+1</Text>
            </Pressable>
          )}
        </View>
      </View>

      {isSetBased && (
        <View style={styles.boardSection}>
          <Text style={styles.boardMeta}>
            Set {(safeScore.sets?.length ?? 0) + (isLive ? 1 : 0)}
            {safeScore.config?.num_sets ? ` of ${safeScore.config.num_sets}` : ''}
            {safeScore.config?.points_to_win
              ? ` · race to ${safeScore.config.points_to_win}, win by ${safeScore.config.win_by ?? 2}`
              : ''}
          </Text>

          <View style={styles.currentSetRow}>
            <View style={styles.currentSetTeam}>
              <Text style={styles.currentSetNumber}>{safeScore.currentSetTeam1 ?? 0}</Text>
              <Pressable
                style={[styles.currentSetButton, (!isLive || scoring) && styles.disabledButton]}
                onPress={() => handlePoint(1)}
                disabled={!isLive || scoring}
              >
                <Text style={styles.boardWinButtonText}>+1</Text>
              </Pressable>
            </View>
            <View style={styles.currentSetTeam}>
              <Text style={styles.currentSetNumber}>{safeScore.currentSetTeam2 ?? 0}</Text>
              <Pressable
                style={[styles.currentSetButton, (!isLive || scoring) && styles.disabledButton]}
                onPress={() => handlePoint(2)}
                disabled={!isLive || scoring}
              >
                <Text style={styles.boardWinButtonText}>+1</Text>
              </Pressable>
            </View>
          </View>

          {safeScore.sets && safeScore.sets.length > 0 && (
            <View style={styles.boardHistory}>
              {safeScore.sets.map((s, i) => (
                <Text key={i} style={styles.boardHistoryRow}>
                  Set {i + 1}: {s.team_1}–{s.team_2} → {teamNames(match, s.winner)}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {isBoardBased && (
        <View style={styles.boardSection}>
          <Text style={styles.boardMeta}>
            Board {(safeScore.boardsPlayed ?? 0) + (isLive ? 1 : 0)}
            {safeScore.config?.max_boards ? ` of ${safeScore.config.max_boards}` : ''}
            {safeScore.config?.points_to_win ? ` · race to ${safeScore.config.points_to_win}` : ''}
          </Text>

          <Text style={styles.fieldLabel}>Points won on this board</Text>
          <TextInput
            style={styles.boardInput}
            placeholder="e.g. 4"
            placeholderTextColor="#9AA69E"
            keyboardType="number-pad"
            value={boardPointsInput}
            onChangeText={setBoardPointsInput}
            editable={isLive && !scoring}
          />

          <View style={styles.boardButtonRow}>
            <Pressable
              style={[
                styles.boardWinButton,
                (!isLive || !boardPointsValid || scoring) && styles.disabledButton,
              ]}
              onPress={() => handlePoint(1, boardPoints)}
              disabled={!isLive || !boardPointsValid || scoring}
            >
              <Text style={styles.boardWinButtonText}>{teamNames(match, 1)} won it</Text>
            </Pressable>
            <Pressable
              style={[
                styles.boardWinButton,
                (!isLive || !boardPointsValid || scoring) && styles.disabledButton,
              ]}
              onPress={() => handlePoint(2, boardPoints)}
              disabled={!isLive || !boardPointsValid || scoring}
            >
              <Text style={styles.boardWinButtonText}>{teamNames(match, 2)} won it</Text>
            </Pressable>
          </View>

          {safeScore.history.length > 0 && (
            <View style={styles.boardHistory}>
              {(safeScore.history as { team: number; points: number }[]).map((b, i) => (
                <Text key={i} style={styles.boardHistoryRow}>
                  Board {i + 1} — {teamNames(match, b.team)} scored {b.points}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      <Pressable
        style={[styles.undoButton, (!canUndo || scoring) && styles.disabledButton]}
        onPress={handleUndo}
        disabled={!canUndo || scoring}
      >
        <Text style={styles.undoButtonText}>
          {isBoardBased ? 'Undo last board' : 'Undo last point'}
        </Text>
      </Pressable>

      {isLive && (
        <Pressable style={styles.concludeButton} onPress={() => setConcludeOpen(true)}>
          <Text style={styles.concludeButtonText}>Conclude match early</Text>
        </Pressable>
      )}

      <Text style={styles.rulesNote}>{formatRulesNote(match)}</Text>

      <Modal visible={concludeOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Conclude match</Text>
            <Text style={styles.modalSubtitle}>
              Only the game's creator can do this. Choose how to end it:
            </Text>

            <Pressable
              style={[styles.concludeOption, concluding && styles.disabledButton]}
              onPress={() => handleConclude('winner')}
              disabled={concluding || safeScore.team_1 === safeScore.team_2}
            >
              <Text style={styles.concludeOptionText}>
                {safeScore.team_1 === safeScore.team_2
                  ? 'Award to current leader (scores are tied)'
                  : `Award win to ${teamNames(match, safeScore.team_1 > safeScore.team_2 ? 1 : 2)} (current leader)`}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.concludeOption, concluding && styles.disabledButton]}
              onPress={() => handleConclude('draw')}
              disabled={concluding}
            >
              <Text style={styles.concludeOptionText}>Record as a draw</Text>
            </Pressable>

            <Pressable
              style={[styles.concludeOption, styles.concludeOptionDanger, concluding && styles.disabledButton]}
              onPress={() => handleConclude('cancelled')}
              disabled={concluding}
            >
              <Text style={[styles.concludeOptionText, styles.concludeOptionDangerText]}>
                Cancel this match
              </Text>
            </Pressable>

            <Pressable style={styles.modalCancelButton} onPress={() => setConcludeOpen(false)}>
              <Text style={styles.modalCancelButtonText}>Back</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  boardSection: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    padding: 16,
  },
  boardMeta: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F6F50',
    marginBottom: 10,
  },
  setsWonLabel: {
    fontSize: 11,
    color: '#8A968F',
    marginTop: -6,
  },
  currentSetRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 4,
  },
  currentSetTeam: {
    alignItems: 'center',
    gap: 8,
  },
  currentSetNumber: {
    fontSize: 32,
    fontWeight: '800',
    color: '#173A2E',
  },
  currentSetButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 999,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
    marginBottom: 6,
  },
  boardInput: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  boardButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  boardWinButton: {
    flex: 1,
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  boardWinButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  boardHistory: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E7ECE9',
    paddingTop: 10,
    gap: 4,
  },
  boardHistoryRow: {
    fontSize: 12,
    color: '#6B7A73',
  },
  concludeButton: {
    marginTop: 14,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  concludeButtonText: {
    fontSize: 12,
    color: '#B3261E',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#173A2E',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7A73',
    marginBottom: 16,
  },
  concludeOption: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  concludeOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#173A2E',
    textAlign: 'center',
  },
  concludeOptionDanger: {
    borderColor: '#F4C7C3',
    backgroundColor: '#FDF3F2',
  },
  concludeOptionDangerText: {
    color: '#B3261E',
  },
  modalCancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  modalCancelButtonText: {
    fontSize: 14,
    color: '#6B7A73',
    fontWeight: '600',
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
