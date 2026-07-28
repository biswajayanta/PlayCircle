import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../../lib/alert';
import { api, ApiError } from '../../lib/api';
import { Circle, Game, UserPublic, Venue } from '../../lib/types';

const FORMATS: Array<Game['format']> = ['doubles', 'singles'];

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

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [format, setFormat] = useState<Game['format']>('doubles');
  const [scheduledAtInput, setScheduledAtInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [addingMember, setAddingMember] = useState(false);

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

  useEffect(() => {
    load();
  }, [load]);

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
        format,
      });
      setGames((prev) => [...prev, created].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
      setCreateOpen(false);
      setSelectedVenue(null);
      setScheduledAtInput('');
      setFormat('doubles');
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

  useEffect(() => {
    if (!addMemberOpen || searchQuery.trim().length === 0) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.get<UserPublic[]>(
          `/users/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, addMemberOpen]);

  async function handleAddByUserId(userId: string) {
    if (!id) return;
    setAddingMember(true);
    try {
      const updated = await api.post<Circle>(`/circles/${id}/members`, { user_id: userId });
      setCircle(updated);
      setAddMemberOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      showAlert('Added!', 'They can now see this circle and its games.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add member';
      showAlert('Could not add', message);
    } finally {
      setAddingMember(false);
    }
  }

  async function handleAddByEmail() {
    if (!id || !emailInput.trim()) return;
    setAddingMember(true);
    try {
      const updated = await api.post<Circle>(`/circles/${id}/members`, {
        email: emailInput.trim(),
      });
      setCircle(updated);
      setAddMemberOpen(false);
      setEmailInput('');
      showAlert('Added!', 'They can now see this circle and its games.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add member';
      showAlert('Could not add', message);
    } finally {
      setAddingMember(false);
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: circle?.name ?? 'Circle' }} />

      {circle && (
        <Text style={styles.subtitle}>
          {circle.member_count} {circle.member_count === 1 ? 'member' : 'members'} · you're{' '}
          {circle.my_role}
        </Text>
      )}

      <View style={styles.actionRow}>
        <Pressable style={styles.newGameButton} onPress={() => setCreateOpen(true)}>
          <Text style={styles.newGameButtonText}>+ New Game</Text>
        </Pressable>
        {circle && (circle.my_role === 'owner' || circle.my_role === 'captain') && (
          <Pressable style={styles.addMemberButton} onPress={() => setAddMemberOpen(true)}>
            <Text style={styles.addMemberButtonText}>+ Add Member</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={games}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onRefresh={load}
        refreshing={loading}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No games scheduled yet. Create one above.</Text>
        }
        renderItem={({ item }) => {
          const statusStyle = STATUS_COLORS[item.status];
          const canJoin = item.status === 'open';
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
                  {item.format} · {item.confirmed_count}/{item.capacity} confirmed
                </Text>
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

            <Text style={styles.fieldLabel}>Format</Text>
            <View style={styles.formatRow}>
              {FORMATS.map((f) => (
                <Pressable
                  key={f}
                  style={[styles.formatOption, format === f && styles.formatOptionSelected]}
                  onPress={() => setFormat(f)}
                >
                  <Text
                    style={[
                      styles.formatOptionText,
                      format === f && styles.formatOptionTextSelected,
                    ]}
                  >
                    {f}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Date &amp; time</Text>
            <TextInput
              style={styles.input}
              placeholder="2026-07-25 18:00"
              value={scheduledAtInput}
              onChangeText={setScheduledAtInput}
            />

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

      <Modal visible={addMemberOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Member</Text>

            <Text style={styles.fieldLabel}>Search by name</Text>
            <TextInput
              style={styles.input}
              placeholder="Search public profiles..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searching && <ActivityIndicator size="small" color="#1F6F50" style={{ marginTop: 8 }} />}
            {!searching && searchQuery.trim().length > 0 && searchResults.length === 0 && (
              <Text style={styles.noResultsText}>
                No public profiles match. If you know their exact email, add them below instead.
              </Text>
            )}
            <FlatList
              data={searchResults}
              keyExtractor={(u) => u.user_id}
              style={styles.searchResultsList}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.searchResultRow}
                  onPress={() => handleAddByUserId(item.user_id)}
                  disabled={addingMember}
                >
                  <Text style={styles.searchResultName}>{item.display_name}</Text>
                  {item.city && <Text style={styles.searchResultCity}>{item.city}</Text>}
                </Pressable>
              )}
            />

            <Text style={styles.fieldLabel}>Or add by exact email</Text>
            <TextInput
              style={styles.input}
              placeholder="their@email.com"
              value={emailInput}
              onChangeText={setEmailInput}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={() => setAddMemberOpen(false)}>
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalCreateButton,
                  (!emailInput.trim() || addingMember) && styles.joinButtonDisabled,
                ]}
                onPress={handleAddByEmail}
                disabled={!emailInput.trim() || addingMember}
              >
                <Text style={styles.modalCreateButtonText}>
                  {addingMember ? 'Adding...' : 'Add by email'}
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
