import { Stack, router, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
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

import { showAlert } from '../../lib/alert';
import { api, ApiError } from '../../lib/api';
import { Sport, Tournament, Venue } from '../../lib/types';

function formatSportBlurb(sport: Sport): string | null {
  const cfg = sport.scoring_config as { win_score?: number; win_by?: number };
  if (cfg.win_score && cfg.win_by) return `Rally to ${cfg.win_score}, win by ${cfg.win_by}`;
  if (cfg.win_score) return `Race to ${cfg.win_score}`;
  return null;
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

export default function NewTournamentScreen() {
  const { circleId } = useLocalSearchParams<{ circleId: string }>();
  const [sports, setSports] = useState<Sport[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
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

  useEffect(() => {
    Promise.all([api.get<Sport[]>('/sports'), api.get<Venue[]>('/venues')])
      .then(([sportsResult, venuesResult]) => {
        // Badminton has no scoring engine yet — hide it, same as New Game.
        setSports(sportsResult.filter((s) => s.code !== 'badminton'));
        setVenues(venuesResult);
      })
      .catch(() => showAlert('Error', 'Failed to load sports/venues'))
      .finally(() => setLoading(false));
  }, []);

  function onNativeDateChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'dismissed' || !selected) return;
    setDateInput(selected.toISOString().slice(0, 10));
  }

  function onNativeTimeChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (event.type === 'dismissed' || !selected) return;
    const hh = String(selected.getHours()).padStart(2, '0');
    const mm = String(selected.getMinutes()).padStart(2, '0');
    setTimeInput(`${hh}:${mm}`);
  }

  async function handleCreate() {
    if (
      !circleId ||
      !name.trim() ||
      !selectedSport ||
      !selectedVenue ||
      !dateInput ||
      !timeInput ||
      creating
    ) {
      return;
    }
    setCreating(true);
    try {
      const scheduledAt = new Date(`${dateInput}T${timeInput}:00`);
      const tournament = await api.post<Tournament>('/tournaments', {
        circle_id: circleId,
        sport_id: selectedSport.id,
        venue_id: selectedVenue.id,
        scheduled_at: scheduledAt.toISOString(),
        name: name.trim(),
      });
      router.replace(`/tournaments/${tournament.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create tournament';
      showAlert('Error', message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  const canCreate =
    !!name.trim() && !!selectedSport && !!selectedVenue && !!dateInput && !!timeInput;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'New Tournament' }} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.fieldLabel}>Tournament name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Summer Carrom Cup"
          placeholderTextColor="#9AA69E"
        />

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
                      setSelectedVenue(null);
                    } else if (selectedVenue) {
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

        <Text style={styles.hintText}>
          This is a closed tournament — only circle members can be added as participants,
          from the bracket screen after this is created.
        </Text>

        {selectedSport && selectedVenue && (
          <Pressable style={styles.createButton} onPress={() => setDateTimeModalOpen(true)}>
            <Text style={styles.createButtonText}>Next: Date &amp; Time</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={dateTimeModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>When?</Text>
            {selectedSport && selectedVenue && (
              <Text style={styles.hintText}>
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
                style={[styles.modalConfirmButton, (!canCreate || creating) && styles.disabledButton]}
                onPress={handleCreate}
                disabled={!canCreate || creating}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {creating ? 'Creating...' : 'Create Tournament'}
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
  container: { flex: 1, backgroundColor: '#F7FAF8' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#173A2E', marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    marginBottom: 4,
  },
  pickerValueText: { fontSize: 14, color: '#173A2E' },
  pickerPlaceholderText: { fontSize: 14, color: '#9AA69E' },
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
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
    marginBottom: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  tabButtonActive: { backgroundColor: '#1F6F50', borderColor: '#1F6F50' },
  tabButtonText: { fontSize: 14, fontWeight: '700', color: '#173A2E' },
  tabButtonTextActive: { color: '#fff' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickCard: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    minWidth: 140,
  },
  pickCardSelected: { backgroundColor: '#1F6F50', borderColor: '#1F6F50' },
  pickCardTitle: { fontSize: 14, fontWeight: '700', color: '#173A2E' },
  pickCardMeta: { fontSize: 12, color: '#6B7A73', marginTop: 2 },
  pickCardBlurb: { fontSize: 11, color: '#8A968F', marginTop: 2 },
  emptyStateText: { fontSize: 13, color: '#8A968F', fontStyle: 'italic' },
  hintText: { fontSize: 12, color: '#8A968F', marginTop: 16, lineHeight: 18 },
  createButton: {
    backgroundColor: '#C9971F',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  createButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabledButton: { opacity: 0.5 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20, maxHeight: '80%' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#173A2E', marginBottom: 4 },
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
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#C9971F',
    alignItems: 'center',
  },
  modalConfirmButtonText: { color: '#fff', fontWeight: '700' },
});
