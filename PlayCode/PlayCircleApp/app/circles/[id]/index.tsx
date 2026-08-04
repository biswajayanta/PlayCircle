import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { Circle, Game, Venue } from '../../../lib/types';

// Plain CSS-in-JS for the raw <input type="datetime-local"> used on web —
// this isn't a React Native style object, it's real DOM CSS properties.
const webDateInputStyle: React.CSSProperties = {
  border: '1px solid #D6DED9',
  borderRadius: 8,
  padding: '12px 14px',
  fontSize: 15,
  backgroundColor: '#fff',
  marginBottom: 12,
  width: '100%',
  boxSizing: 'border-box',
  color: '#173A2E',
  fontFamily: 'inherit',
};

const STATUS_COLORS: Record<Game['status'], { bg: string; text: string }> = {
  open: { bg: '#E6F1EC', text: '#1F6F50' },
  full: { bg: '#FDECEA', text: '#B3261E' },
  completed: { bg: '#EDEDED', text: '#5F5F5F' },
  cancelled: { bg: '#EDEDED', text: '#5F5F5F' },
};

function formatScheduledAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function expenseBadge(item: Game): { label: string; bg: string; text: string } {
  if (!item.has_expenses) {
    return { label: 'No expenses', bg: '#F1F4F2', text: '#6B7A73' };
  }
  if (item.all_settled) {
    return { label: 'Settled up', bg: '#E6F1EC', text: '#1F6F50' };
  }
  return { label: 'Payment pending', bg: '#FDF2E3', text: '#9A6A00' };
}

// Today first, then upcoming games soonest-first, then past games most
// recent first — so the list always opens on what's actually relevant to
// act on right now, with history collapsible below it.
function groupAndSortGames(games: Game[], showOlder: boolean): Game[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateStr = (g: Game) => g.scheduled_at.slice(0, 10);

  const today = games.filter((g) => !g.is_past && dateStr(g) === todayStr);
  const upcoming = games.filter((g) => !g.is_past && dateStr(g) > todayStr);
  const older = games.filter((g) => g.is_past);

  today.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  upcoming.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  older.sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  return [...today, ...upcoming, ...(showOlder ? older : [])];
}

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [showOlderGames, setShowOlderGames] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [circleResult, gamesResult, venuesResult] = await Promise.all([
        api.get<Circle>(`/circles/${id}`),
        api.get<Game[]>(`/games?circle_id=${id}`),
        api.get<Venue[]>('/venues'),
      ]);
      setCircle(circleResult);
      setGames(gamesResult);
      setVenues(venuesResult);
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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleCreateGame() {
    if (!id || !selectedVenue) return;
    const scheduledAt = new Date(scheduledAtInput);
    if (Number.isNaN(scheduledAt.getTime())) {
      showAlert(
        'Invalid date',
        'Enter the date and time like 2026-07-25 18:00'
      );
      return;
    }
    setCreating(true);
    try {
      const created = await api.post<Game>('/games', {
        circle_id: id,
        sport_id: selectedVenue.sport_id,
        venue_id: selectedVenue.id,
        scheduled_at: scheduledAt.toISOString(),
      });
      setGames((prev) => [...prev, created].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
      setCreateOpen(false);
      setSelectedVenue(null);
      setScheduledAtInput('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create game';
      showAlert('Could not create game', message);
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinGame(game: Game) {
    setJoiningId(game.id);
    try {
      await api.post(`/games/${game.id}/join`);
      showAlert('Joined!', `You're in for ${formatScheduledAt(game.scheduled_at)}.`);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to join game';
      showAlert('Could not join', message);
    } finally {
      setJoiningId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const olderGamesCount = games.filter((g) => g.is_past).length;
  const displayedGames = groupAndSortGames(games, showOlderGames);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: circle?.name ?? 'Circle' }} />

      {circle && <Text style={styles.subtitle}>You're {circle.my_role}</Text>}

      {circle && (
        <Pressable
          style={styles.membersLink}
          onPress={() => router.push(`/circles/${id}/members`)}
        >
          <Text style={styles.membersLinkText}>
            👥 {circle.member_count} {circle.member_count === 1 ? 'Member' : 'Members'}
          </Text>
        </Pressable>
      )}

      <View style={styles.actionRow}>
        <Pressable style={styles.newGameButton} onPress={() => setCreateOpen(true)}>
          <Text style={styles.newGameButtonText}>+ New Game</Text>
        </Pressable>
        <Pressable
          style={styles.reportButton}
          onPress={() => router.push(`/circles/${id}/report`)}
        >
          <Text style={styles.reportButtonText}>📊 Report</Text>
        </Pressable>
      </View>

      {olderGamesCount > 0 && (
        <Pressable
          style={styles.toggleOlderButton}
          onPress={() => setShowOlderGames((prev) => !prev)}
        >
          <Text style={styles.toggleOlderButtonText}>
            {showOlderGames
              ? 'Hide older games'
              : `Show ${olderGamesCount} older ${olderGamesCount === 1 ? 'game' : 'games'}`}
          </Text>
        </Pressable>
      )}

      <FlatList
        data={displayedGames}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onRefresh={load}
        refreshing={loading}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No games scheduled yet. Create one above.</Text>
        }
        renderItem={({ item }) => {
          const statusStyle = STATUS_COLORS[item.status];
          const expBadge = expenseBadge(item);
          const canJoin = item.status === 'open' && !item.already_joined && !item.is_past;
          return (
            <View style={styles.card}>
              <Pressable onPress={() => router.push(`/games/${item.id}`)}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.venue_name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusStyle.text }]}>
                      {item.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.cardSubtitle}>{formatScheduledAt(item.scheduled_at)}</Text>
                <Text style={styles.cardMeta}>
                  {item.confirmed_count} {item.confirmed_count === 1 ? 'player' : 'players'} joined
                  {item.is_past && item.status !== 'cancelled' ? ' · Past' : ''}
                </Text>
                <View style={[styles.expenseBadge, { backgroundColor: expBadge.bg }]}>
                  <Text style={[styles.expenseBadgeText, { color: expBadge.text }]}>
                    {expBadge.label}
                  </Text>
                </View>
              </Pressable>
              {canJoin && (
                <Pressable
                  style={[styles.joinButton, joiningId === item.id && styles.joinButtonDisabled]}
                  onPress={() => handleJoinGame(item)}
                  disabled={joiningId === item.id}
                >
                  <Text style={styles.joinButtonText}>
                    {joiningId === item.id ? 'Joining...' : 'Join'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />

      <Modal visible={createOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Game</Text>

            <Text style={styles.fieldLabel}>Venue</Text>
            <FlatList
              data={venues}
              keyExtractor={(v) => String(v.id)}
              style={styles.venueList}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.venueOption,
                    selectedVenue?.id === item.id && styles.venueOptionSelected,
                  ]}
                  onPress={() => setSelectedVenue(item)}
                >
                  <Text
                    style={[
                      styles.venueOptionText,
                      selectedVenue?.id === item.id && styles.venueOptionTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />

            <Text style={styles.fieldLabel}>Date &amp; time</Text>
            {Platform.OS === 'web' ? (
              React.createElement('input', {
                type: 'datetime-local',
                value: scheduledAtInput,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  setScheduledAtInput(e.target.value),
                style: webDateInputStyle,
              })
            ) : (
              <TextInput
                placeholderTextColor="#9AA69E"
                style={styles.input}
                placeholder="2026-07-25 18:00"
                value={scheduledAtInput}
                onChangeText={setScheduledAtInput}
              />
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setCreateOpen(false)}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalCreateButton,
                  (!selectedVenue || creating) && styles.joinButtonDisabled,
                ]}
                onPress={handleCreateGame}
                disabled={!selectedVenue || creating}
              >
                <Text style={styles.modalCreateButtonText}>
                  {creating ? 'Creating...' : 'Create'}
                </Text>
              </Pressable>
            </View>
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
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 24,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7A73',
    marginBottom: 12,
    textTransform: 'capitalize',
  },
  membersLink: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F4F2',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 16,
  },
  membersLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#173A2E',
  },
  membersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F4F2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  memberChipName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  memberRoleBadge: {
    backgroundColor: '#1F6F50',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  memberRoleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
  memberRemoveX: {
    fontSize: 13,
    color: '#B3261E',
    fontWeight: '700',
    marginLeft: 2,
  },
  leaveLink: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  leaveLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B3261E',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
  },
  modalBodyText: {
    fontSize: 14,
    color: '#6B7A73',
    marginBottom: 20,
    lineHeight: 20,
  },
  modalDangerButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#B3261E',
    alignItems: 'center',
  },
  modalConfirmButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  newGameButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  reportButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F4F2',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  reportButtonText: {
    color: '#1F6F50',
    fontWeight: '600',
  },
  addMemberButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F4F2',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addMemberButtonText: {
    color: '#1F6F50',
    fontWeight: '600',
  },
  newGameButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#173A2E',
    flexShrink: 1,
    paddingRight: 8,
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B7A73',
  },
  cardMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#8A968F',
    textTransform: 'capitalize',
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  expenseBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 8,
  },
  expenseBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  toggleOlderButton: {
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  toggleOlderButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F6F50',
  },
  joinButton: {
    marginTop: 10,
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  joinButtonDisabled: {
    opacity: 0.6,
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7A73',
    marginTop: 40,
    fontSize: 14,
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
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#173A2E',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
    marginTop: 12,
    marginBottom: 6,
  },
  venueList: {
    maxHeight: 140,
  },
  searchResultsList: {
    maxHeight: 160,
  },
  searchResultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    marginBottom: 6,
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#173A2E',
  },
  searchResultCity: {
    fontSize: 12,
    color: '#8A968F',
  },
  noResultsText: {
    fontSize: 12,
    color: '#8A968F',
    marginTop: 6,
    marginBottom: 6,
  },
  venueOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    marginBottom: 6,
  },
  venueOptionSelected: {
    backgroundColor: '#1F6F50',
    borderColor: '#1F6F50',
  },
  venueOptionText: {
    fontSize: 14,
    color: '#173A2E',
  },
  venueOptionTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  formatRow: {
    flexDirection: 'row',
    gap: 8,
  },
  formatOption: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  formatOptionSelected: {
    backgroundColor: '#1F6F50',
    borderColor: '#1F6F50',
  },
  formatOptionText: {
    fontSize: 14,
    color: '#173A2E',
    textTransform: 'capitalize',
  },
  formatOptionTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: '#173A2E',
    fontWeight: '600',
  },
  modalCreateButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1F6F50',
    alignItems: 'center',
  },
  modalCreateButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
