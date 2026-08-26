import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../../lib/alert';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/authContext';
import { Sport, UserProfile } from '../../lib/types';

const SUGGESTED_LEVELS = ['District', 'State', 'National', 'International', 'Club', 'Open'];

export default function ProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user } = useAuth();
  const isOwnProfile = user?.user_id === userId;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sports, setSports] = useState<Sport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [bioInput, setBioInput] = useState('');
  const [sportsInterestInput, setSportsInterestInput] = useState('');
  const [ageInput, setAgeInput] = useState('');
  const [heightInput, setHeightInput] = useState('');
  const [weightInput, setWeightInput] = useState('');
  const [saving, setSaving] = useState(false);

  const [achievementOpen, setAchievementOpen] = useState(false);
  const [selectedSportId, setSelectedSportId] = useState<number | null>(null);
  const [levelInput, setLevelInput] = useState('');
  const [eventNameInput, setEventNameInput] = useState('');
  const [rankInput, setRankInput] = useState('');
  const [addingAchievement, setAddingAchievement] = useState(false);
  const [removingAchievementId, setRemovingAchievementId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      const result = await api.get<UserProfile>(`/users/${userId}/profile`);
      setProfile(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get<Sport[]>('/sports').then(setSports).catch(() => {});
  }, []);

  function openEdit() {
    if (!profile) return;
    setBioInput(profile.bio ?? '');
    setSportsInterestInput(profile.sports_interest ?? '');
    setAgeInput(profile.age != null ? String(profile.age) : '');
    setHeightInput(profile.height_cm != null ? String(profile.height_cm) : '');
    setWeightInput(profile.weight_kg != null ? String(profile.weight_kg) : '');
    setEditOpen(true);
  }

  async function handleSaveProfile() {
    if (saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        bio: bioInput,
        sports_interest: sportsInterestInput || null,
      };
      const age = parseInt(ageInput, 10);
      payload.age = ageInput.trim() && Number.isInteger(age) ? age : null;
      const height = parseFloat(heightInput);
      payload.height_cm = heightInput.trim() && !Number.isNaN(height) ? height : null;
      const weight = parseFloat(weightInput);
      payload.weight_kg = weightInput.trim() && !Number.isNaN(weight) ? weight : null;

      await api.patch('/me', payload);
      setEditOpen(false);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update profile';
      showAlert('Error', message);
    } finally {
      setSaving(false);
    }
  }

  function openAddAchievement() {
    setSelectedSportId(null);
    setLevelInput('');
    setEventNameInput('');
    setRankInput('');
    setAchievementOpen(true);
  }

  async function handleAddAchievement() {
    if (!selectedSportId || !levelInput.trim() || !eventNameInput.trim() || !rankInput.trim()) return;
    if (addingAchievement) return;
    setAddingAchievement(true);
    try {
      await api.post('/users/me/achievements', {
        sport_id: selectedSportId,
        level: levelInput.trim(),
        event_name: eventNameInput.trim(),
        rank: rankInput.trim(),
      });
      setAchievementOpen(false);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add achievement';
      showAlert('Error', message);
    } finally {
      setAddingAchievement(false);
    }
  }

  async function handleRemoveAchievement(achievementId: string) {
    if (removingAchievementId) return;
    setRemovingAchievementId(achievementId);
    try {
      await api.delete(`/users/me/achievements/${achievementId}`);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to remove achievement';
      showAlert('Error', message);
    } finally {
      setRemovingAchievementId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Profile not found'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: profile.display_name }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.name}>{profile.display_name}</Text>
        {profile.city && <Text style={styles.city}>{profile.city}</Text>}

        {isOwnProfile && (
          <Pressable style={styles.editButton} onPress={openEdit}>
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </Pressable>
        )}

        {profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bodyText}>{profile.bio}</Text>
          </View>
        )}

        {profile.sports_interest && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sports I play or follow</Text>
            <Text style={styles.bodyText}>{profile.sports_interest}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <DetailRow label="Age" value={profile.age != null ? String(profile.age) : null} verified={profile.age_verified} />
          <DetailRow
            label="Height"
            value={profile.height_cm != null ? `${profile.height_cm} cm` : null}
            verified={profile.height_verified}
          />
          <DetailRow
            label="Weight"
            value={profile.weight_kg != null ? `${profile.weight_kg} kg` : null}
            verified={profile.weight_verified}
          />
        </View>

        {profile.performance.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Performance</Text>
            {profile.performance.map((p) => (
              <View key={p.sport_id} style={styles.perfRow}>
                <Text style={styles.perfSport}>{p.sport_name}</Text>
                <Text style={styles.perfStats}>
                  {p.wins}W · {p.losses}L · {p.matches_played} played · {p.win_rate}% win rate
                  {p.tournaments_played > 0
                    ? ` · ${p.tournaments_played} ${p.tournaments_played === 1 ? 'tournament' : 'tournaments'}`
                    : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.achievementsHeader}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            {isOwnProfile && (
              <Pressable onPress={openAddAchievement}>
                <Text style={styles.addAchievementLink}>+ Add</Text>
              </Pressable>
            )}
          </View>
          {profile.achievements.length === 0 ? (
            <Text style={styles.emptyText}>No achievements added yet.</Text>
          ) : (
            profile.achievements.map((a) => (
              <View key={a.id} style={styles.achievementCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.achievementTitle}>
                    {a.rank} · {a.event_name}
                  </Text>
                  <Text style={styles.achievementMeta}>
                    {a.sport_name} · {a.level}
                    {!a.verified ? ' · Unverified' : ' · ✓ Verified'}
                  </Text>
                </View>
                {isOwnProfile && (
                  <Pressable
                    onPress={() => handleRemoveAchievement(a.id)}
                    disabled={removingAchievementId === a.id}
                    hitSlop={8}
                  >
                    <Text style={styles.removeAchievementText}>
                      {removingAchievementId === a.id ? '...' : 'Remove'}
                    </Text>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={editOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>Edit Profile</Text>

              <Text style={styles.fieldLabel}>About me</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={bioInput}
                onChangeText={setBioInput}
                placeholder="A little about yourself"
                placeholderTextColor="#9AA69E"
                multiline
              />

              <Text style={styles.fieldLabel}>Sports I play or follow</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={sportsInterestInput}
                onChangeText={setSportsInterestInput}
                placeholder="e.g. Carrom competitively, casual Pickleball on weekends"
                placeholderTextColor="#9AA69E"
                multiline
              />

              <Text style={styles.fieldLabel}>Age</Text>
              <TextInput
                style={styles.input}
                value={ageInput}
                onChangeText={setAgeInput}
                placeholder="e.g. 28"
                placeholderTextColor="#9AA69E"
                keyboardType="number-pad"
              />

              <Text style={styles.fieldLabel}>Height (cm)</Text>
              <TextInput
                style={styles.input}
                value={heightInput}
                onChangeText={setHeightInput}
                placeholder="e.g. 175"
                placeholderTextColor="#9AA69E"
                keyboardType="decimal-pad"
              />

              <Text style={styles.fieldLabel}>Weight (kg)</Text>
              <TextInput
                style={styles.input}
                value={weightInput}
                onChangeText={setWeightInput}
                placeholder="e.g. 70"
                placeholderTextColor="#9AA69E"
                keyboardType="decimal-pad"
              />

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelButton} onPress={() => setEditOpen(false)}>
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalConfirmButton, saving && styles.disabledButton]}
                  onPress={handleSaveProfile}
                  disabled={saving}
                >
                  <Text style={styles.modalConfirmButtonText}>{saving ? 'Saving...' : 'Save'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={achievementOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>Add Achievement</Text>

              <Text style={styles.fieldLabel}>Sport</Text>
              <View style={styles.chipRow}>
                {sports.map((s) => (
                  <Pressable
                    key={s.id}
                    style={[styles.chip, selectedSportId === s.id && styles.chipSelected]}
                    onPress={() => setSelectedSportId(s.id)}
                  >
                    <Text
                      style={[styles.chipText, selectedSportId === s.id && styles.chipTextSelected]}
                    >
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Level</Text>
              <View style={styles.chipRow}>
                {SUGGESTED_LEVELS.map((l) => (
                  <Pressable
                    key={l}
                    style={[styles.chip, levelInput === l && styles.chipSelected]}
                    onPress={() => setLevelInput(l)}
                  >
                    <Text style={[styles.chipText, levelInput === l && styles.chipTextSelected]}>
                      {l}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={levelInput}
                onChangeText={setLevelInput}
                placeholder="Or type a custom level"
                placeholderTextColor="#9AA69E"
              />

              <Text style={styles.fieldLabel}>Event name</Text>
              <TextInput
                style={styles.input}
                value={eventNameInput}
                onChangeText={setEventNameInput}
                placeholder="e.g. 2026 Summer Carrom Cup"
                placeholderTextColor="#9AA69E"
              />

              <Text style={styles.fieldLabel}>Rank / placement</Text>
              <TextInput
                style={styles.input}
                value={rankInput}
                onChangeText={setRankInput}
                placeholder="e.g. Winner, Runner-up, 3rd place"
                placeholderTextColor="#9AA69E"
              />

              <Text style={styles.hintText}>
                New achievements start as unverified — verification isn't set up yet.
              </Text>

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancelButton}
                  onPress={() => setAchievementOpen(false)}
                >
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalConfirmButton,
                    (!selectedSportId ||
                      !levelInput.trim() ||
                      !eventNameInput.trim() ||
                      !rankInput.trim() ||
                      addingAchievement) &&
                      styles.disabledButton,
                  ]}
                  onPress={handleAddAchievement}
                  disabled={
                    !selectedSportId ||
                    !levelInput.trim() ||
                    !eventNameInput.trim() ||
                    !rankInput.trim() ||
                    addingAchievement
                  }
                >
                  <Text style={styles.modalConfirmButtonText}>
                    {addingAchievement ? 'Adding...' : 'Add'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({
  label,
  value,
  verified,
}: {
  label: string;
  value: string | null;
  verified: boolean;
}) {
  if (value == null) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailValueRow}>
        <Text style={styles.detailValue}>{value}</Text>
        <Text style={verified ? styles.verifiedBadge : styles.unverifiedBadge}>
          {verified ? '✓ Verified' : 'Unverified'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAF8' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 14, color: '#B3261E', marginBottom: 12 },
  retryButton: { backgroundColor: '#1F6F50', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20 },
  retryButtonText: { color: '#fff', fontWeight: '700' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  name: { fontSize: 22, fontWeight: '800', color: '#173A2E' },
  city: { fontSize: 13, color: '#6B7A73', marginTop: 2 },
  editButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  editButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#173A2E', marginBottom: 8 },
  bodyText: { fontSize: 14, color: '#173A2E', lineHeight: 20 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailLabel: { fontSize: 13, color: '#6B7A73' },
  detailValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#173A2E' },
  verifiedBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1F6F50',
    backgroundColor: '#E3F1EA',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  unverifiedBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8A968F',
    backgroundColor: '#F1F4F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  perfRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F1F4F2' },
  perfSport: { fontSize: 14, fontWeight: '700', color: '#173A2E' },
  perfStats: { fontSize: 12, color: '#6B7A73', marginTop: 2 },
  achievementsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addAchievementLink: { fontSize: 13, fontWeight: '700', color: '#1F6F50' },
  emptyText: { fontSize: 13, color: '#8A968F', fontStyle: 'italic' },
  achievementCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  achievementTitle: { fontSize: 14, fontWeight: '600', color: '#173A2E' },
  achievementMeta: { fontSize: 12, color: '#6B7A73', marginTop: 2 },
  removeAchievementText: { fontSize: 12, fontWeight: '600', color: '#B3261E' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#173A2E', marginBottom: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#173A2E', marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  multilineInput: { minHeight: 70, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  chipSelected: { backgroundColor: '#1F6F50', borderColor: '#1F6F50' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#173A2E' },
  chipTextSelected: { color: '#fff' },
  hintText: { fontSize: 11, color: '#8A968F', marginTop: 12, lineHeight: 16 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20, marginBottom: 4 },
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
  modalConfirmButton: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#1F6F50', alignItems: 'center' },
  modalConfirmButtonText: { color: '#fff', fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
});
