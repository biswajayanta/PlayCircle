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
import { PersonalContribution, SettlementSuggestion, Sport, UserLedgerOut, UserProfile } from '../../lib/types';

const SUGGESTED_LEVELS = ['District', 'State', 'National', 'International', 'Club', 'Open'];

function formatMoney(amount: string): string {
  return `₹${Number(amount).toFixed(2)}`;
}

function formatContributionDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

function contributionContext(c: PersonalContribution): string {
  if (c.kind === 'expense_share') {
    const game =
      c.sport_name && c.venue_name
        ? `${c.sport_name} · ${c.venue_name}`
        : c.description;
    return c.is_payer ? `You paid — ${game}` : `Your share — ${game}`;
  }
  return c.kind === 'transfer_sent'
    ? `You paid ${c.counterparty_display_name ?? ''}`
    : `${c.counterparty_display_name ?? ''} paid you`;
}

function formatDateOfBirth(iso: string): string {
  const dob = new Date(`${iso}T00:00:00`);
  const formatted = dob.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return `${formatted} (age ${age})`;
}

export default function ProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user } = useAuth();
  const isOwnProfile = user?.user_id === userId;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sports, setSports] = useState<Sport[]>([]);
  const [ledger, setLedger] = useState<UserLedgerOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [settleTarget, setSettleTarget] = useState<{
    circleId: string;
    suggestion: SettlementSuggestion;
  } | null>(null);
  const [settling, setSettling] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [bioInput, setBioInput] = useState('');
  const [sportsInterestInput, setSportsInterestInput] = useState('');
  const [dobInput, setDobInput] = useState('');
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

  const loadLedger = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await api.get<UserLedgerOut>(`/users/${userId}/ledger`);
      setLedger(result);
    } catch {
      // Non-critical — the rest of the profile still works without it.
    }
  }, [userId]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  function openSettle(circleId: string, suggestion: SettlementSuggestion) {
    setSettleTarget({ circleId, suggestion });
  }

  async function handleConfirmSettle() {
    if (!settleTarget || settling) return;
    setSettling(true);
    try {
      await api.post(`/circles/${settleTarget.circleId}/transfers`, {
        from_user_id: settleTarget.suggestion.from_user_id,
        to_user_id: settleTarget.suggestion.to_user_id,
        amount: settleTarget.suggestion.amount,
        note: 'Settled from profile',
      });
      setSettleTarget(null);
      await loadLedger();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to record payment';
      showAlert('Could not settle', message);
    } finally {
      setSettling(false);
    }
  }

  function openEdit() {
    if (!profile) return;
    setBioInput(profile.bio ?? '');
    setSportsInterestInput(profile.sports_interest ?? '');
    setDobInput(profile.date_of_birth ?? '');
    setHeightInput(profile.height_cm != null ? String(profile.height_cm) : '');
    setWeightInput(profile.weight_kg != null ? String(profile.weight_kg) : '');
    setEditOpen(true);
  }

  async function handleSaveProfile() {
    if (saving) return;
    setSaving(true);
    try {
      const trimmedDob = dobInput.trim();
      if (trimmedDob && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDob)) {
        showAlert('Invalid date', 'Enter date of birth as YYYY-MM-DD, e.g. 1996-01-15');
        setSaving(false);
        return;
      }
      const payload: Record<string, unknown> = {
        bio: bioInput,
        sports_interest: sportsInterestInput || null,
        date_of_birth: trimmedDob || null,
      };
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
          <DetailRow
            label="Date of Birth"
            value={profile.date_of_birth != null ? formatDateOfBirth(profile.date_of_birth) : null}
            verified={profile.date_of_birth_verified}
          />
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

        {ledger && ledger.circles.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Ledger</Text>
            {ledger.circles.map((c) => {
              const balanceValue = Number(c.balance);
              return (
                <View key={c.circle_id} style={styles.ledgerCircleCard}>
                  <View style={styles.ledgerCircleHeader}>
                    <Text style={styles.ledgerCircleName}>{c.circle_name}</Text>
                    <Text
                      style={[
                        styles.ledgerBalanceText,
                        balanceValue > 0 && styles.ledgerBalancePositive,
                        balanceValue < 0 && styles.ledgerBalanceNegative,
                      ]}
                    >
                      {balanceValue === 0
                        ? 'Settled up'
                        : balanceValue > 0
                          ? `Is owed ${formatMoney(c.balance)}`
                          : `Owes ${formatMoney(String(-balanceValue))}`}
                    </Text>
                  </View>

                  {isOwnProfile &&
                    c.quick_settle
                      .filter((s) => s.from_user_id === user?.user_id)
                      .map((s, i) => (
                        <Pressable
                          key={i}
                          style={styles.settleButton}
                          onPress={() => openSettle(c.circle_id, s)}
                        >
                          <Text style={styles.settleButtonText}>
                            Pay {s.to_display_name} {formatMoney(s.amount)} →
                          </Text>
                        </Pressable>
                      ))}

                  {c.entries.length === 0 ? (
                    <Text style={styles.emptyText}>Nothing recorded yet.</Text>
                  ) : (
                    c.entries.map((entry) => (
                      <View key={entry.id} style={styles.ledgerEntryRow}>
                        <View style={styles.ledgerEntryInfo}>
                          <Text style={styles.ledgerEntryDescription} numberOfLines={1}>
                            {contributionContext(entry)}
                          </Text>
                          <Text style={styles.ledgerEntryMeta}>
                            {formatContributionDate(entry.created_at)}
                          </Text>
                        </View>
                        <Text style={styles.ledgerEntryAmount}>{formatMoney(entry.amount)}</Text>
                      </View>
                    ))
                  )}
                </View>
              );
            })}
          </View>
        )}
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

              <Text style={styles.fieldLabel}>Date of Birth</Text>
              <TextInput
                style={styles.input}
                value={dobInput}
                onChangeText={setDobInput}
                placeholder="YYYY-MM-DD, e.g. 1996-01-15"
                placeholderTextColor="#9AA69E"
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

      <Modal visible={settleTarget !== null} animationType="fade" transparent>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.modalTitle}>Confirm payment</Text>
            {settleTarget && (
              <Text style={styles.confirmBodyText}>
                Record that you paid{' '}
                <Text style={{ fontWeight: '700' }}>{settleTarget.suggestion.to_display_name}</Text>{' '}
                <Text style={{ fontWeight: '700' }}>{formatMoney(settleTarget.suggestion.amount)}</Text>?
                This updates the circle ledger immediately.
              </Text>
            )}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setSettleTarget(null)}
                disabled={settling}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmButton, settling && styles.disabledButton]}
                onPress={handleConfirmSettle}
                disabled={settling}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {settling ? 'Recording...' : 'Confirm'}
                </Text>
              </Pressable>
            </View>
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
  ledgerCircleCard: {
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F4F2',
  },
  ledgerCircleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ledgerCircleName: { fontSize: 14, fontWeight: '700', color: '#173A2E' },
  ledgerBalanceText: { fontSize: 13, fontWeight: '700', color: '#8A968F' },
  ledgerBalancePositive: { color: '#1F6F50' },
  ledgerBalanceNegative: { color: '#B3261E' },
  settleButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 10,
  },
  settleButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  ledgerEntryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  ledgerEntryInfo: { flex: 1, paddingRight: 8 },
  ledgerEntryDescription: { fontSize: 13, color: '#173A2E' },
  ledgerEntryMeta: { fontSize: 11, color: '#8A968F', marginTop: 1 },
  ledgerEntryAmount: { fontSize: 13, fontWeight: '600', color: '#173A2E' },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  confirmBodyText: { fontSize: 14, color: '#173A2E', lineHeight: 20, marginTop: 8 },
});
