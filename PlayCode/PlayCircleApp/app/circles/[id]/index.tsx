import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { subscribeToDataChanged } from '../../../lib/assistantEvents';
import { Circle, Game, Sport, Tournament, Venue } from '../../../lib/types';

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

// Cosmetic only — reads scoring_config directly so this works automatically
// for any future sport with recognizable keys, no per-sport map to maintain.
function formatSportBlurb(sport: Sport): string | null {
  const cfg = sport.scoring_config as { win_score?: number; win_by?: number };
  if (cfg.win_score && cfg.win_by) return `Rally to ${cfg.win_score}, win by ${cfg.win_by}`;
  if (cfg.win_score) return `Race to ${cfg.win_score}`;
  return null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Format a Date's LOCAL date/time as 'YYYY-MM-DD' / 'HH:mm'. Deliberately not
// toISOString() — that converts to UTC first, which silently shifts the date
// or time whenever local time isn't UTC (i.e. basically always in IST).
function formatDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTimeInput(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

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
  return { label: 'Has expenses', bg: '#E6F1EC', text: '#1F6F50' };
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
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'sport' | 'venue'>('sport');
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [venueSearchQuery, setVenueSearchQuery] = useState('');
  const [dateTimeModalOpen, setDateTimeModalOpen] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [showOlderGames, setShowOlderGames] = useState(false);
  const [activeListTab, setActiveListTab] = useState<'games' | 'tournaments'>('games');
  const [showOlderTournaments, setShowOlderTournaments] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [circleResult, gamesResult, tournamentsResult, venuesResult, sportsResult] =
        await Promise.all([
          api.get<Circle>(`/circles/${id}`),
          api.get<Game[]>(`/games?circle_id=${id}`),
          api.get<Tournament[]>(`/tournaments?circle_id=${id}`),
          api.get<Venue[]>('/venues'),
          api.get<Sport[]>('/sports'),
        ]);
      setCircle(circleResult);
      setGames(gamesResult);
      setTournaments(tournamentsResult);
      setVenues(venuesResult);
      // Badminton has no scoring engine yet — hide it from selection until
      // one exists. Remove this filter once app/scoring/badminton.py lands.
      setSports(sportsResult.filter((s) => s.code !== 'badminton'));
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

  useEffect(() => {
    return subscribeToDataChanged((event) => {
      if (event.entityType === 'circle' && event.entityId === id) {
        load();
      }
    });
  }, [id, load]);

  // Android dismisses the picker itself and reports event.type; iOS keeps it
  // open inline, so we only close it here on Android after a real selection.
  function onNativeDateChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'set' && selected) setDateInput(formatDateInput(selected));
  }

  function onNativeTimeChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (event.type === 'set' && selected) setTimeInput(formatTimeInput(selected));
  }

  async function handleCreateGame() {
    if (!id || !selectedSport || !selectedVenue) return;
    if (!dateInput || !timeInput) {
      showAlert('Missing date or time', 'Pick both a date and a time for the game.');
      return;
    }
    const scheduledAt = new Date(`${dateInput}T${timeInput}`);
    if (Number.isNaN(scheduledAt.getTime())) {
      showAlert('Invalid date', 'Pick a valid date and time.');
      return;
    }
    setCreating(true);
    try {
      const created = await api.post<Game>('/games', {
        circle_id: id,
        sport_id: selectedSport.id,
        venue_id: selectedVenue.id,
        scheduled_at: scheduledAt.toISOString(),
      });
      setGames((prev) => [...prev, created].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
      setCreateOpen(false);
      setDateTimeModalOpen(false);
      setSelectedSport(null);
      setSelectedVenue(null);
      setPickerTab('sport');
      setVenueSearchQuery('');
      setDateInput('');
      setTimeInput('');
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

  const olderTournamentsCount = tournaments.filter(
    (t) => t.status === 'completed' || t.status === 'cancelled'
  ).length;
  const displayedTournaments = showOlderTournaments
    ? tournaments
    : tournaments.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
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
        <Pressable
          style={styles.newGameButton}
          onPress={() => {
            setSelectedSport(null);
            setSelectedVenue(null);
            setPickerTab('sport');
            setVenueSearchQuery('');
            setDateTimeModalOpen(false);
            setDateInput('');
            setTimeInput('');
            setCreateOpen(true);
          }}
        >
          <Text style={styles.newGameButtonText}>+ New Game</Text>
        </Pressable>
        <Pressable
          style={styles.newTournamentButton}
          onPress={() => router.push(`/tournaments/new?circleId=${id}`)}
        >
          <Text style={styles.newTournamentButtonText}>🏆 New Tournament</Text>
        </Pressable>
        <Pressable
          style={styles.reportButton}
          onPress={() => router.push(`/circles/${id}/report`)}
        >
          <Text style={styles.reportButtonText}>📊 Report</Text>
        </Pressable>
        <Pressable
          style={styles.reportButton}
          onPress={() => router.push(`/circles/${id}/ledger`)}
        >
          <Text style={styles.reportButtonText}>📒 Ledger</Text>
        </Pressable>
        <Pressable style={styles.reportButton} onPress={() => router.push('/search')}>
          <Text style={styles.reportButtonText}>🔍 Find Member</Text>
        </Pressable>
      </View>

      <View style={styles.listTabRow}>
        <Pressable
          style={[styles.listTabButton, activeListTab === 'games' && styles.listTabButtonActive]}
          onPress={() => setActiveListTab('games')}
        >
          <Text
            style={[
              styles.listTabButtonText,
              activeListTab === 'games' && styles.listTabButtonTextActive,
            ]}
          >
            Games
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.listTabButton,
            activeListTab === 'tournaments' && styles.listTabButtonActive,
          ]}
          onPress={() => setActiveListTab('tournaments')}
        >
          <Text
            style={[
              styles.listTabButtonText,
              activeListTab === 'tournaments' && styles.listTabButtonTextActive,
            ]}
          >
            Tournaments
          </Text>
        </Pressable>
      </View>

      {activeListTab === 'tournaments' && (
        <>
          {olderTournamentsCount > 0 && (
            <Pressable
              style={[
                styles.pastToggleButton,
                showOlderTournaments && styles.pastToggleButtonActive,
              ]}
              onPress={() => setShowOlderTournaments((prev) => !prev)}
            >
              <Text
                style={[
                  styles.pastToggleButtonText,
                  showOlderTournaments && styles.pastToggleButtonTextActive,
                ]}
              >
                {showOlderTournaments
                  ? 'Hide Past Tournaments'
                  : `Past Tournaments (${olderTournamentsCount})`}
              </Text>
            </Pressable>
          )}

          <View style={styles.listContent}>
            {displayedTournaments.length === 0 ? (
              <Text style={styles.emptyText}>No active tournaments. Create one above.</Text>
            ) : (
              displayedTournaments.map((t) => (
                <Pressable
                  key={t.id}
                  style={styles.tournamentRow}
                  onPress={() => router.push(`/tournaments/${t.id}`)}
                >
                  <View>
                    <Text style={styles.tournamentRowName}>{t.name}</Text>
                    <Text style={styles.tournamentRowMeta}>
                      {t.sport_name} · {t.participant_count} players · {tournamentStatusLabel(t.status)}
                    </Text>
                  </View>
                  <Text style={styles.tournamentRowArrow}>›</Text>
                </Pressable>
              ))
            )}
          </View>
        </>
      )}

      {activeListTab === 'games' && (
        <>
          {olderGamesCount > 0 && (
            <Pressable
              style={[styles.pastToggleButton, showOlderGames && styles.pastToggleButtonActive]}
              onPress={() => setShowOlderGames((prev) => !prev)}
            >
              <Text
                style={[
                  styles.pastToggleButtonText,
                  showOlderGames && styles.pastToggleButtonTextActive,
                ]}
              >
                {showOlderGames ? 'Hide Past Games' : `Past Games (${olderGamesCount})`}
              </Text>
            </Pressable>
          )}

          <View style={styles.listContent}>
            {displayedGames.length === 0 ? (
              <Text style={styles.emptyText}>No games scheduled yet. Create one above.</Text>
            ) : (
              displayedGames.map((item) => {
                const statusStyle = STATUS_COLORS[item.status];
                const expBadge = expenseBadge(item);
                const canJoin = item.status === 'open' && !item.already_joined && !item.is_past;
                return (
                  <View key={item.id} style={styles.card}>
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
              })
            )}
          </View>
        </>
      )}

      <Modal visible={createOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Game</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.tabRow}>
              <Pressable
                style={[styles.tabButton, pickerTab === 'sport' && styles.tabButtonActive]}
                onPress={() => {
                  setPickerTab('sport');
                  setVenueSearchQuery('');
                }}
              >
                <Text style={[styles.tabButtonText, pickerTab === 'sport' && styles.tabButtonTextActive]}>
                  Sport
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabButton, pickerTab === 'venue' && styles.tabButtonActive]}
                onPress={() => {
                  setPickerTab('venue');
                  setVenueSearchQuery('');
                }}
              >
                <Text style={[styles.tabButtonText, pickerTab === 'venue' && styles.tabButtonTextActive]}>
                  Venue
                </Text>
              </Pressable>
            </View>

            {pickerTab === 'sport' ? (
              <>
                <Text style={styles.fieldLabel}>Choose a sport</Text>
                <View style={styles.cardGrid}>
                  {sports.map((sport) => (
                    <Pressable
                      key={sport.id}
                      style={[styles.pickCard, selectedSport?.id === sport.id && styles.pickCardSelected]}
                      onPress={() => {
                        setSelectedSport(sport);
                        if (selectedVenue && !selectedVenue.sport_ids.includes(sport.id)) {
                          // Doesn't host this sport — clear it rather than
                          // leave a stale, invalid pairing.
                          setSelectedVenue(null);
                        } else if (selectedVenue) {
                          // Venue was already compatible — both sides of
                          // the pair are now set, so move straight to
                          // date/time instead of leaving it buried below.
                          setDateTimeModalOpen(true);
                        }
                      }}
                    >
                      <Text style={styles.pickCardTitle}>{sport.name}</Text>
                      <Text style={styles.pickCardMeta}>
                        {sport.indoor_outdoor} · {sport.min_players}-{sport.max_players} players
                      </Text>
                      {formatSportBlurb(sport) && (
                        <Text style={styles.pickCardBlurb}>{formatSportBlurb(sport)}</Text>
                      )}
                    </Pressable>
                  ))}
                </View>

                {selectedSport && (
                  <>
                    <Text style={styles.fieldLabel}>Venue</Text>
                    {venues.filter((v) => v.sport_ids.includes(selectedSport.id)).length > 4 && (
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search venues..."
                        placeholderTextColor="#9AA69E"
                        value={venueSearchQuery}
                        onChangeText={setVenueSearchQuery}
                      />
                    )}
                    <View style={styles.cardGrid}>
                      {venues
                        .filter((v) => v.sport_ids.includes(selectedSport.id))
                        .filter((v) => v.name.toLowerCase().includes(venueSearchQuery.toLowerCase()))
                        .map((venue) => (
                          <Pressable
                            key={venue.id}
                            style={[styles.pickCard, selectedVenue?.id === venue.id && styles.pickCardSelected]}
                            onPress={() => {
                              setSelectedVenue(venue);
                              // This list is already filtered to venues that
                              // host the selected sport, so the pair is
                              // complete the moment a venue is tapped here.
                              setDateTimeModalOpen(true);
                            }}
                          >
                            <Text style={styles.pickCardTitle}>{venue.name}</Text>
                            {venue.address && <Text style={styles.pickCardMeta}>{venue.address}</Text>}
                          </Pressable>
                        ))}
                      {venues.filter((v) => v.sport_ids.includes(selectedSport.id)).length === 0 && (
                        <Text style={styles.emptyStateText}>
                          No venues host {selectedSport.name} yet.
                        </Text>
                      )}
                    </View>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Choose a venue</Text>
                {venues.length > 4 && (
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search venues..."
                    placeholderTextColor="#9AA69E"
                    value={venueSearchQuery}
                    onChangeText={setVenueSearchQuery}
                  />
                )}
                <View style={styles.cardGrid}>
                  {venues
                    .filter((v) => v.name.toLowerCase().includes(venueSearchQuery.toLowerCase()))
                    .map((venue) => (
                      <Pressable
                        key={venue.id}
                        style={[styles.pickCard, selectedVenue?.id === venue.id && styles.pickCardSelected]}
                        onPress={() => {
                          setSelectedVenue(venue);
                          if (selectedSport && !venue.sport_ids.includes(selectedSport.id)) {
                            setSelectedSport(null);
                          } else if (selectedSport) {
                            setDateTimeModalOpen(true);
                          }
                        }}
                      >
                        <Text style={styles.pickCardTitle}>{venue.name}</Text>
                        {venue.address && <Text style={styles.pickCardMeta}>{venue.address}</Text>}
                        <Text style={styles.pickCardBlurb}>
                          {sports
                            .filter((s) => venue.sport_ids.includes(s.id))
                            .map((s) => s.name)
                            .join(' · ')}
                        </Text>
                      </Pressable>
                    ))}
                </View>

                {selectedVenue && (
                  <>
                    <Text style={styles.fieldLabel}>Sport</Text>
                    <View style={styles.cardGrid}>
                      {sports
                        .filter((s) => selectedVenue.sport_ids.includes(s.id))
                        .map((sport) => (
                          <Pressable
                            key={sport.id}
                            style={[styles.pickCard, selectedSport?.id === sport.id && styles.pickCardSelected]}
                            onPress={() => {
                              setSelectedSport(sport);
                              // Venue is already selected and this list is
                              // pre-filtered to sports it hosts, so tapping
                              // here always completes the pair.
                              setDateTimeModalOpen(true);
                            }}
                          >
                            <Text style={styles.pickCardTitle}>{sport.name}</Text>
                            {formatSportBlurb(sport) && (
                              <Text style={styles.pickCardBlurb}>{formatSportBlurb(sport)}</Text>
                            )}
                          </Pressable>
                        ))}
                    </View>
                  </>
                )}
              </>
            )}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setCreateOpen(false)}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              {selectedSport && selectedVenue && (
                <Pressable
                  style={styles.modalCreateButton}
                  onPress={() => setDateTimeModalOpen(true)}
                >
                  <Text style={styles.modalCreateButtonText}>Next: Date &amp; Time</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={dateTimeModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>When?</Text>
            {selectedSport && selectedVenue && (
              <Text style={styles.dateTimeSummary}>
                {selectedSport.name} at {selectedVenue.name}
              </Text>
            )}

            <Text style={styles.fieldLabel}>Date</Text>
            {Platform.OS === 'web' ? (
              React.createElement('input', {
                type: 'date',
                value: dateInput,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  setDateInput(e.target.value),
                style: webDateInputStyle,
              })
            ) : (
              <>
                <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
                  <Text style={dateInput ? styles.pickerValueText : styles.pickerPlaceholderText}>
                    {dateInput || 'Choose a date'}
                  </Text>
                </Pressable>
                {showDatePicker && (
                  <DateTimePicker
                    value={dateInput ? new Date(`${dateInput}T00:00:00`) : new Date()}
                    mode="date"
                    display="default"
                    onChange={onNativeDateChange}
                  />
                )}
              </>
            )}

            <Text style={styles.fieldLabel}>Time</Text>
            {Platform.OS === 'web' ? (
              React.createElement('input', {
                type: 'time',
                value: timeInput,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  setTimeInput(e.target.value),
                style: webDateInputStyle,
              })
            ) : (
              <>
                <Pressable style={styles.input} onPress={() => setShowTimePicker(true)}>
                  <Text style={timeInput ? styles.pickerValueText : styles.pickerPlaceholderText}>
                    {timeInput || 'Choose a time'}
                  </Text>
                </Pressable>
                {showTimePicker && (
                  <DateTimePicker
                    value={timeInput ? new Date(`2000-01-01T${timeInput}:00`) : new Date()}
                    mode="time"
                    display="default"
                    onChange={onNativeTimeChange}
                  />
                )}
              </>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setDateTimeModalOpen(false)}
              >
                <Text style={styles.modalCancelButtonText}>Back</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalCreateButton,
                  (!selectedSport || !selectedVenue || !dateInput || !timeInput || creating) &&
                    styles.joinButtonDisabled,
                ]}
                onPress={handleCreateGame}
                disabled={!selectedSport || !selectedVenue || !dateInput || !timeInput || creating}
              >
                <Text style={styles.modalCreateButtonText}>
                  {creating ? 'Creating...' : 'Create'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function tournamentStatusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'draft':
      return 'Setting up';
    case 'fixture_set':
      return 'Bracket set';
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
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
    flexWrap: 'wrap',
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
  newTournamentButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#C9971F',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  newTournamentButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  listTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
    marginBottom: 4,
  },
  listTabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  listTabButtonActive: { backgroundColor: '#1F6F50', borderColor: '#1F6F50' },
  listTabButtonText: { fontSize: 14, fontWeight: '700', color: '#173A2E' },
  listTabButtonTextActive: { color: '#fff' },
  tournamentsSection: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#173A2E',
    marginBottom: 8,
  },
  tournamentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    padding: 12,
    marginBottom: 8,
  },
  tournamentRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#173A2E',
  },
  tournamentRowMeta: {
    fontSize: 12,
    color: '#6B7A73',
    marginTop: 2,
  },
  tournamentRowArrow: {
    fontSize: 20,
    color: '#B8C4BE',
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
  pastToggleButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F4F2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  pastToggleButtonActive: {
    backgroundColor: '#1F6F50',
    borderColor: '#1F6F50',
  },
  pastToggleButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F6F50',
  },
  pastToggleButtonTextActive: {
    color: '#fff',
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
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#F0F4F1',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
  },
  tabButtonTextActive: {
    color: '#1F6F50',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickCard: {
    minWidth: '47%',
    flexGrow: 1,
    borderWidth: 1.5,
    borderColor: '#E7ECE9',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
  },
  pickCardSelected: {
    borderColor: '#1F6F50',
    backgroundColor: '#F0F8F4',
  },
  pickCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#173A2E',
  },
  pickCardMeta: {
    fontSize: 12,
    color: '#6B7A73',
    marginTop: 2,
  },
  pickCardBlurb: {
    fontSize: 11,
    color: '#8A968F',
    marginTop: 4,
  },
  emptyStateText: {
    fontSize: 13,
    color: '#8A968F',
    fontStyle: 'italic',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  dateTimeSummary: {
    fontSize: 13,
    color: '#6B7A73',
    marginBottom: 14,
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
    justifyContent: 'center',
  },
  pickerValueText: {
    fontSize: 15,
    color: '#173A2E',
  },
  pickerPlaceholderText: {
    fontSize: 15,
    color: '#9AA69E',
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
