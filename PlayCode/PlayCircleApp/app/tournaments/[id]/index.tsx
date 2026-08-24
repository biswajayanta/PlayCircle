import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import BracketTree from '../../../components/BracketTree';
import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { Bracket, Sport, Tournament, TournamentMatch, TournamentParticipant } from '../../../lib/types';

interface CircleMember {
  user_id: string;
  display_name: string;
}

const webDateInputStyle: React.CSSProperties = {
  border: '1px solid #D6DED9',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 14,
  marginBottom: 14,
  width: '100%',
  boxSizing: 'border-box',
};

export default function TournamentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [circleMembers, setCircleMembers] = useState<CircleMember[]>([]);
  const [bracket, setBracket] = useState<Bracket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addingParticipant, setAddingParticipant] = useState<string | null>(null); // user_id being added
  const [removingParticipant, setRemovingParticipant] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [walkoverMatch, setWalkoverMatch] = useState<TournamentMatch | null>(null);
  const [rearrangeMode, setRearrangeMode] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{
    matchId: string;
    slot: 'player_1' | 'player_2';
    label: string;
  } | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [startingSlotId, setStartingSlotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('tree');
  const [sportConfig, setSportConfig] = useState<Record<string, unknown> | null>(null);
  const [configMatch, setConfigMatch] = useState<TournamentMatch | null>(null);
  const [pointsToWinInput, setPointsToWinInput] = useState('');
  const [maxBoardsInput, setMaxBoardsInput] = useState('');
  const [numSetsChoice, setNumSetsChoice] = useState<1 | 3 | 5>(3);
  const [pointsPerSetChoice, setPointsPerSetChoice] = useState<11 | 15 | 21>(11);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const t = await api.get<Tournament>(`/tournaments/${id}`);
      setTournament(t);

      const [p, members] = await Promise.all([
        api.get<TournamentParticipant[]>(`/tournaments/${id}/participants`),
        api.get<CircleMember[]>(`/circles/${t.circle_id}/members`),
      ]);
      setParticipants(p);
      setCircleMembers(members);

      const allSports = await api.get<Sport[]>('/sports');
      const sport = allSports.find((s) => s.id === t.sport_id);
      setSportConfig(sport?.scoring_config ?? null);

      if (t.status !== 'draft') {
        const b = await api.get<Bracket>(`/tournaments/${id}/bracket`);
        setBracket(b);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tournament');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleAddParticipant(userId: string) {
    if (!id || addingParticipant) return;
    setAddingParticipant(userId);
    try {
      await api.post(`/tournaments/${id}/participants`, { user_id: userId });
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add participant';
      showAlert('Error', message);
    } finally {
      setAddingParticipant(null);
    }
  }

  async function handleGenerateBracket() {
    if (!id || generating) return;
    setGenerating(true);
    try {
      await api.post(`/tournaments/${id}/bracket`, { random_seed: true });
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to generate bracket';
      showAlert('Error', message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRemoveParticipant(userId: string) {
    if (!id || removingParticipant) return;
    setRemovingParticipant(userId);
    try {
      await api.delete(`/tournaments/${id}/participants/${userId}`);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to remove participant';
      showAlert('Error', message);
    } finally {
      setRemovingParticipant(null);
    }
  }

  const isBoardBasedSport =
    !!sportConfig && 'win_score' in sportConfig && !('win_by' in sportConfig);
  const isSetBasedSport =
    !!sportConfig && 'win_score' in sportConfig && 'win_by' in sportConfig;

  function openStartConfig(match: TournamentMatch) {
    const defaultPoints = sportConfig?.win_score;
    if (typeof defaultPoints === 'number') {
      setPointsToWinInput(String(defaultPoints));
    } else {
      setPointsToWinInput('');
    }
    const defaultMaxBoards = sportConfig?.max_boards;
    setMaxBoardsInput(typeof defaultMaxBoards === 'number' ? String(defaultMaxBoards) : '');
    if (defaultPoints === 11 || defaultPoints === 15 || defaultPoints === 21) {
      setPointsPerSetChoice(defaultPoints);
    } else {
      setPointsPerSetChoice(11);
    }
    setNumSetsChoice(3);
    setConfigMatch(match);
  }

  async function handleStartMatch(slotId: string) {
    if (!id || startingSlotId) return;
    setStartingSlotId(slotId);
    try {
      const overrides: { points_to_win?: number; max_boards?: number; num_sets?: number } = {};
      if (isBoardBasedSport) {
        const parsedPoints = parseInt(pointsToWinInput, 10);
        if (Number.isInteger(parsedPoints) && parsedPoints >= 1) {
          overrides.points_to_win = parsedPoints;
        }
        if (maxBoardsInput.trim()) {
          const parsedBoards = parseInt(maxBoardsInput, 10);
          if (Number.isInteger(parsedBoards) && parsedBoards >= 1) {
            overrides.max_boards = parsedBoards;
          }
        }
      } else if (isSetBasedSport) {
        overrides.points_to_win = pointsPerSetChoice;
        overrides.num_sets = numSetsChoice;
      }

      const result = await api.post<TournamentMatch>(
        `/tournaments/${id}/matches/${slotId}/start`,
        overrides
      );
      setConfigMatch(null);
      if (result.match_id) {
        router.push(`/matches/${result.match_id}`);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to start match';
      showAlert('Error', message);
    } finally {
      setStartingSlotId(null);
    }
  }

  async function handleWalkover(winnerUserId: string) {
    if (!id || !walkoverMatch) return;
    try {
      await api.post(`/tournaments/${id}/matches/${walkoverMatch.id}/walkover`, {
        winner_user_id: winnerUserId,
      });
      setWalkoverMatch(null);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to record walkover';
      showAlert('Error', message);
    }
  }

  async function handleSlotTap(
    matchId: string,
    slot: 'player_1' | 'player_2',
    label: string
  ) {
    if (!id || swapping) return;

    if (!selectedSlot) {
      setSelectedSlot({ matchId, slot, label });
      return;
    }
    if (selectedSlot.matchId === matchId && selectedSlot.slot === slot) {
      setSelectedSlot(null); // tapped the same slot again — cancel
      return;
    }

    setSwapping(true);
    try {
      await api.post(`/tournaments/${id}/swap`, {
        match_a_id: selectedSlot.matchId,
        slot_a: selectedSlot.slot,
        match_b_id: matchId,
        slot_b: slot,
      });
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to swap players';
      showAlert('Error', message);
    } finally {
      setSelectedSlot(null);
      setSwapping(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !tournament) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Tournament not found'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const participantIds = new Set(participants.map((p) => p.user_id));
  const availableToAdd = circleMembers.filter((m) => !participantIds.has(m.user_id));

  const champion =
    tournament.status === 'completed' && bracket
      ? bracket.matches.find((m) => m.round_number === bracket.total_rounds)
      : null;

  // Mirrors the backend's _round1_open check: no bracket yet, or at least
  // one Round 1 match still undecided.
  const round1Matches = bracket?.matches.filter((m) => m.round_number === 1) ?? [];
  const round1Open =
    !bracket || round1Matches.length === 0 ||
    round1Matches.some((m) => m.status !== 'completed' && m.status !== 'walkover');

  const matchesByRound: Record<number, TournamentMatch[]> = {};
  if (bracket) {
    for (const m of bracket.matches) {
      (matchesByRound[m.round_number] ??= []).push(m);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: tournament.name }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{tournament.name}</Text>
        <Text style={styles.subtitle}>
          {tournament.sport_name} · {tournament.circle_name} · {statusLabel(tournament.status)}
        </Text>

        {champion && (
          <View style={styles.championBanner}>
            <Text style={styles.championText}>
              🏆 {champion.winner_user_id === champion.player_1_user_id
                ? champion.player_1_display_name
                : champion.player_2_display_name}{' '}
              is the champion!
            </Text>
          </View>
        )}

        {round1Open && (
          <>
            <Text style={styles.sectionTitle}>Participants ({participants.length})</Text>
            {participants.map((p) => (
              <View key={p.user_id} style={styles.participantRow}>
                <Text style={styles.participantRowText}>{p.display_name}</Text>
                <Pressable
                  onPress={() => handleRemoveParticipant(p.user_id)}
                  disabled={removingParticipant === p.user_id}
                  hitSlop={8}
                >
                  <Text style={styles.removeParticipantText}>
                    {removingParticipant === p.user_id ? '...' : 'Remove'}
                  </Text>
                </Pressable>
              </View>
            ))}

            {availableToAdd.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>Add from circle</Text>
                {availableToAdd.map((m) => (
                  <Pressable
                    key={m.user_id}
                    style={styles.addRow}
                    onPress={() => handleAddParticipant(m.user_id)}
                    disabled={addingParticipant === m.user_id}
                  >
                    <Text style={styles.addRowText}>{m.display_name}</Text>
                    <Text style={styles.addRowAction}>
                      {addingParticipant === m.user_id ? '...' : '+ Add'}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}

            {(!bracket || bracket.matches.length === 0) && (
              <>
                <Pressable
                  style={[
                    styles.primaryButton,
                    (participants.length < 2 || generating) && styles.disabledButton,
                  ]}
                  onPress={handleGenerateBracket}
                  disabled={participants.length < 2 || generating}
                >
                  <Text style={styles.primaryButtonText}>
                    {generating ? 'Generating...' : 'Generate Bracket (Random Seed)'}
                  </Text>
                </Pressable>
                {participants.length < 2 && (
                  <Text style={styles.hintText}>Add at least 2 participants first.</Text>
                )}
              </>
            )}
            {bracket && bracket.matches.length > 0 && (
              <Text style={styles.hintText}>
                Bracket is set — adding or removing players here updates it automatically,
                right up until every Round 1 match is decided.
              </Text>
            )}
          </>
        )}

        {bracket && (
          <Pressable
            style={[styles.rearrangeButton, rearrangeMode && styles.rearrangeButtonActive]}
            onPress={() => {
              setRearrangeMode((prev) => !prev);
              setSelectedSlot(null);
              if (!rearrangeMode) setViewMode('list'); // swap only works in List view for now
            }}
          >
            <Text
              style={[
                styles.rearrangeButtonText,
                rearrangeMode && styles.rearrangeButtonTextActive,
              ]}
            >
              {rearrangeMode ? '✕ Done Rearranging' : '⇄ Rearrange Players'}
            </Text>
          </Pressable>
        )}

        {rearrangeMode && (
          <Text style={styles.hintText}>
            {selectedSlot
              ? `Tap another Round 1 player to swap with ${selectedSlot.label}.`
              : 'Tap any Round 1 player, then tap another to swap them. Rearranging is only available in Round 1.'}
          </Text>
        )}

        {bracket && !rearrangeMode && (
          <View style={styles.viewModeToggle}>
            <Pressable
              style={[styles.viewModeButton, viewMode === 'tree' && styles.viewModeButtonActive]}
              onPress={() => setViewMode('tree')}
            >
              <Text
                style={[
                  styles.viewModeButtonText,
                  viewMode === 'tree' && styles.viewModeButtonTextActive,
                ]}
              >
                Tree
              </Text>
            </Pressable>
            <Pressable
              style={[styles.viewModeButton, viewMode === 'list' && styles.viewModeButtonActive]}
              onPress={() => setViewMode('list')}
            >
              <Text
                style={[
                  styles.viewModeButtonText,
                  viewMode === 'list' && styles.viewModeButtonTextActive,
                ]}
              >
                List
              </Text>
            </Pressable>
          </View>
        )}

        {bracket && viewMode === 'tree' && (
          <BracketTree
            bracket={bracket}
            canStartMatches={!!tournament.game_id}
            startingSlotId={startingSlotId}
            onStartMatch={openStartConfig}
            onWalkover={setWalkoverMatch}
            onContinueScoring={(matchId) => router.push(`/matches/${matchId}`)}
          />
        )}

        {bracket &&
          viewMode === 'list' &&
          Object.keys(matchesByRound)
            .map(Number)
            .sort((a, b) => a - b)
            .map((roundNum) => (
              <View key={roundNum} style={styles.roundSection}>
                <Text style={styles.roundTitle}>
                  {roundLabel(roundNum, bracket.total_rounds)}
                </Text>
                {matchesByRound[roundNum].map((m) => {
                  const eligible =
                    m.round_number === 1 && (m.status === 'pending' || m.status === 'ready');
                  const p1Selected =
                    selectedSlot?.matchId === m.id && selectedSlot.slot === 'player_1';
                  const p2Selected =
                    selectedSlot?.matchId === m.id && selectedSlot.slot === 'player_2';
                  return (
                  <View key={m.id} style={styles.matchCard}>
                    <View style={styles.matchPlayers}>
                      {rearrangeMode && eligible ? (
                        <Pressable
                          onPress={() =>
                            handleSlotTap(m.id, 'player_1', m.player_1_display_name ?? 'TBD')
                          }
                        >
                          <Text
                            style={[
                              styles.matchPlayerName,
                              m.winner_user_id === m.player_1_user_id && styles.matchWinnerName,
                              p1Selected && styles.matchPlayerNameSelected,
                            ]}
                          >
                            {m.player_1_display_name ?? 'TBD'}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text
                          style={[
                            styles.matchPlayerName,
                            m.winner_user_id === m.player_1_user_id && styles.matchWinnerName,
                          ]}
                        >
                          {m.player_1_display_name ?? 'TBD'}
                        </Text>
                      )}
                      <Text style={styles.matchVs}>vs</Text>
                      {rearrangeMode && eligible && m.status !== 'walkover' ? (
                        <Pressable
                          onPress={() =>
                            handleSlotTap(m.id, 'player_2', m.player_2_display_name ?? 'TBD')
                          }
                        >
                          <Text
                            style={[
                              styles.matchPlayerName,
                              m.winner_user_id === m.player_2_user_id && styles.matchWinnerName,
                              p2Selected && styles.matchPlayerNameSelected,
                            ]}
                          >
                            {m.player_2_display_name ?? 'TBD'}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text
                          style={[
                            styles.matchPlayerName,
                            m.winner_user_id === m.player_2_user_id && styles.matchWinnerName,
                          ]}
                        >
                          {m.player_2_display_name ?? (m.status === 'walkover' ? 'BYE' : 'TBD')}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.matchStatus}>{matchStatusLabel(m.status)}</Text>

                    {m.status === 'ready' && tournament.game_id && (
                      <View style={styles.matchActions}>
                        {m.player_1_user_id && m.player_2_user_id && (
                          <Pressable
                            style={styles.matchActionButton}
                            onPress={() => openStartConfig(m)}
                            disabled={startingSlotId === m.id}
                          >
                            <Text style={styles.matchActionButtonText}>
                              {startingSlotId === m.id ? 'Starting...' : 'Start Match'}
                            </Text>
                          </Pressable>
                        )}
                        <Pressable
                          style={styles.matchActionButtonSecondary}
                          onPress={() => setWalkoverMatch(m)}
                        >
                          <Text style={styles.matchActionButtonSecondaryText}>Walkover</Text>
                        </Pressable>
                      </View>
                    )}

                    {m.status === 'in_progress' && (
                      <View style={styles.matchActions}>
                        <Pressable
                          style={styles.matchActionButton}
                          onPress={() => m.match_id && router.push(`/matches/${m.match_id}`)}
                        >
                          <Text style={styles.matchActionButtonText}>Continue Scoring</Text>
                        </Pressable>
                        <Pressable
                          style={styles.matchActionButtonSecondary}
                          onPress={() => setWalkoverMatch(m)}
                        >
                          <Text style={styles.matchActionButtonSecondaryText}>Walkover</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                  );
                })}
              </View>
            ))}
      </ScrollView>

      <Modal visible={walkoverMatch !== null} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Award Walkover</Text>
            <Text style={styles.hintText}>Who advances without playing?</Text>
            {walkoverMatch?.player_1_user_id && (
              <Pressable
                style={styles.walkoverOption}
                onPress={() => handleWalkover(walkoverMatch.player_1_user_id!)}
              >
                <Text style={styles.walkoverOptionText}>{walkoverMatch.player_1_display_name}</Text>
              </Pressable>
            )}
            {walkoverMatch?.player_2_user_id && (
              <Pressable
                style={styles.walkoverOption}
                onPress={() => handleWalkover(walkoverMatch.player_2_user_id!)}
              >
                <Text style={styles.walkoverOptionText}>{walkoverMatch.player_2_display_name}</Text>
              </Pressable>
            )}
            <Pressable style={styles.modalCancelButton} onPress={() => setWalkoverMatch(null)}>
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={configMatch !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Match Settings</Text>
            {configMatch && (
              <Text style={styles.hintText}>
                {configMatch.player_1_display_name} vs {configMatch.player_2_display_name}
              </Text>
            )}

            {isBoardBasedSport && (
              <>
                <Text style={styles.fieldLabel}>Points to win</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={pointsToWinInput}
                  onChangeText={setPointsToWinInput}
                  placeholder="25"
                  placeholderTextColor="#9AA69E"
                />
                <Text style={styles.fieldLabel}>Max boards (optional)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={maxBoardsInput}
                  onChangeText={setMaxBoardsInput}
                  placeholder="Unlimited"
                  placeholderTextColor="#9AA69E"
                />
              </>
            )}

            {isSetBasedSport && (
              <>
                <Text style={styles.fieldLabel}>Number of sets</Text>
                <View style={styles.toggleRow}>
                  {([1, 3, 5] as const).map((n) => (
                    <Pressable
                      key={n}
                      style={[styles.toggleButton, numSetsChoice === n && styles.toggleButtonSelected]}
                      onPress={() => setNumSetsChoice(n)}
                    >
                      <Text
                        style={[
                          styles.toggleButtonText,
                          numSetsChoice === n && styles.toggleButtonTextSelected,
                        ]}
                      >
                        {n}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Points per set</Text>
                <View style={styles.toggleRow}>
                  {([11, 15, 21] as const).map((n) => (
                    <Pressable
                      key={n}
                      style={[
                        styles.toggleButton,
                        pointsPerSetChoice === n && styles.toggleButtonSelected,
                      ]}
                      onPress={() => setPointsPerSetChoice(n)}
                    >
                      <Text
                        style={[
                          styles.toggleButtonText,
                          pointsPerSetChoice === n && styles.toggleButtonTextSelected,
                        ]}
                      >
                        {n}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={() => setConfigMatch(null)}>
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmButton, startingSlotId && styles.disabledButton]}
                onPress={() => configMatch && handleStartMatch(configMatch.id)}
                disabled={!!startingSlotId}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {startingSlotId ? 'Starting...' : 'Start Match'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function statusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'draft':
      return 'Setting up';
    case 'fixture_set':
      return 'Fixture set';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function matchStatusLabel(status: TournamentMatch['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting on previous round';
    case 'ready':
      return 'Ready to play';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'walkover':
      return 'Walkover';
    default:
      return status;
  }
}

function roundLabel(roundNum: number, totalRounds: number): string {
  if (roundNum === totalRounds) return 'Final';
  if (roundNum === totalRounds - 1) return 'Semifinal';
  if (roundNum === totalRounds - 2) return 'Quarterfinal';
  return `Round ${roundNum}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAF8' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, color: '#B3261E', marginBottom: 12 },
  retryButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  retryButtonText: { color: '#fff', fontWeight: '700' },
  scrollContent: { padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#173A2E' },
  subtitle: { fontSize: 13, color: '#6B7A73', marginTop: 4, marginBottom: 16 },
  championBanner: {
    backgroundColor: '#FFF9EC',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  championText: { fontSize: 15, fontWeight: '700', color: '#173A2E', textAlign: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#173A2E', marginBottom: 8 },
  participantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E7ECE9',
  },
  participantRowText: { fontSize: 14, color: '#173A2E' },
  removeParticipantText: { fontSize: 13, fontWeight: '600', color: '#B3261E' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#173A2E', marginTop: 12, marginBottom: 6 },
  addRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E7ECE9',
  },
  addRowText: { fontSize: 14, color: '#173A2E' },
  addRowAction: { fontSize: 13, fontWeight: '700', color: '#1F6F50' },
  primaryButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hintText: { fontSize: 12, color: '#8A968F', marginTop: 8, textAlign: 'center' },
  disabledButton: { opacity: 0.5 },
  roundSection: { marginTop: 24 },
  viewModeToggle: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
    alignSelf: 'flex-start',
  },
  viewModeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    backgroundColor: '#fff',
  },
  viewModeButtonActive: { backgroundColor: '#1F6F50', borderColor: '#1F6F50' },
  viewModeButtonText: { fontSize: 13, fontWeight: '600', color: '#173A2E' },
  viewModeButtonTextActive: { color: '#fff' },
  roundTitle: { fontSize: 16, fontWeight: '800', color: '#1F6F50', marginBottom: 10 },
  matchCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  matchPlayers: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  matchPlayerName: { fontSize: 15, fontWeight: '600', color: '#173A2E' },
  matchPlayerNameSelected: {
    color: '#fff',
    backgroundColor: '#C9971F',
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  rearrangeButton: {
    alignSelf: 'flex-start',
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    backgroundColor: '#fff',
  },
  rearrangeButtonActive: { backgroundColor: '#C9971F', borderColor: '#C9971F' },
  rearrangeButtonText: { fontSize: 13, fontWeight: '700', color: '#173A2E' },
  rearrangeButtonTextActive: { color: '#fff' },
  matchWinnerName: { color: '#1F6F50', fontWeight: '800' },
  matchVs: { fontSize: 12, color: '#8A968F' },
  matchStatus: { fontSize: 12, color: '#8A968F', marginTop: 6 },
  matchActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  matchActionButton: {
    flex: 1,
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  matchActionButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  matchActionButtonSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  matchActionButtonSecondaryText: { color: '#173A2E', fontWeight: '600', fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#173A2E', marginBottom: 12 },
  venueList: { maxHeight: 160, marginBottom: 8 },
  venueOption: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    marginBottom: 6,
  },
  venueOptionSelected: { backgroundColor: '#1F6F50', borderColor: '#1F6F50' },
  venueOptionText: { fontSize: 14, color: '#173A2E' },
  input: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  pickerValueText: { fontSize: 14, color: '#173A2E' },
  pickerPlaceholderText: { fontSize: 14, color: '#9AA69E' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  modalCancelButtonText: { color: '#173A2E', fontWeight: '600' },
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  toggleButtonSelected: { backgroundColor: '#1F6F50', borderColor: '#1F6F50' },
  toggleButtonText: { fontSize: 14, fontWeight: '700', color: '#173A2E' },
  toggleButtonTextSelected: { color: '#fff' },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1F6F50',
    alignItems: 'center',
  },
  modalConfirmButtonText: { color: '#fff', fontWeight: '700' },
  walkoverOption: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    marginBottom: 8,
  },
  walkoverOptionText: { fontSize: 15, fontWeight: '600', color: '#173A2E', textAlign: 'center' },
});
