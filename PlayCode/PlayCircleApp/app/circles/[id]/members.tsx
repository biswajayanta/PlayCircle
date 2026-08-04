import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { Circle, CircleMember, UserPublic } from '../../../lib/types';

export default function CircleMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CircleMember | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [circleResult, membersResult] = await Promise.all([
        api.get<Circle>(`/circles/${id}`),
        api.get<CircleMember[]>(`/circles/${id}/members`),
      ]);
      setCircle(circleResult);
      setMembers(membersResult);
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
      load();
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
      load();
      showAlert('Added!', 'They can now see this circle and its games.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add member';
      showAlert('Could not add', message);
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember() {
    if (!id || !removeTarget) return;
    setRemovingUserId(removeTarget.user_id);
    try {
      await api.delete(`/circles/${id}/members/${removeTarget.user_id}`);
      setMembers((prev) => prev.filter((m) => m.user_id !== removeTarget.user_id));
      setCircle((prev) => (prev ? { ...prev, member_count: prev.member_count - 1 } : prev));
      setRemoveTarget(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to remove member';
      showAlert('Could not remove', message);
    } finally {
      setRemovingUserId(null);
    }
  }

  async function handleLeaveCircle() {
    if (!id) return;
    setLeaving(true);
    try {
      await api.post(`/circles/${id}/leave`);
      setLeaveConfirmOpen(false);
      showAlert('You left the circle', "You can rejoin anytime you're re-added.");
      router.replace('/');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to leave circle';
      setLeaveConfirmOpen(false);
      showAlert('Could not leave', message);
    } finally {
      setLeaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !circle) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Circle not found'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const canManage = circle.my_role === 'owner' || circle.my_role === 'captain';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${circle.name} · Members` }} />

      <Text style={styles.subtitle}>
        {circle.member_count} {circle.member_count === 1 ? 'member' : 'members'}
      </Text>

      {canManage && (
        <Pressable style={styles.addMemberButton} onPress={() => setAddMemberOpen(true)}>
          <Text style={styles.addMemberButtonText}>+ Add Member</Text>
        </Pressable>
      )}

      <FlatList
        data={members}
        keyExtractor={(m) => m.user_id}
        contentContainerStyle={styles.listContent}
        onRefresh={load}
        refreshing={loading}
        renderItem={({ item: m }) => (
          <View style={styles.memberRow}>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{m.display_name}</Text>
              {m.role !== 'member' && (
                <View style={styles.memberRoleBadge}>
                  <Text style={styles.memberRoleBadgeText}>{m.role}</Text>
                </View>
              )}
            </View>
            {circle.my_role === 'owner' && m.role !== 'owner' && (
              <Pressable
                onPress={() => setRemoveTarget(m)}
                disabled={removingUserId === m.user_id}
                hitSlop={8}
              >
                <Text style={styles.memberRemoveX}>✕ Remove</Text>
              </Pressable>
            )}
          </View>
        )}
      />

      {circle.my_role !== 'owner' && (
        <Pressable style={styles.leaveLink} onPress={() => setLeaveConfirmOpen(true)}>
          <Text style={styles.leaveLinkText}>Leave this circle</Text>
        </Pressable>
      )}

      <Modal visible={addMemberOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Member</Text>

            <Text style={styles.fieldLabel}>Search by name</Text>
            <TextInput
              placeholderTextColor="#9AA69E"
              style={styles.input}
              placeholder="Search public profiles..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searching && (
              <ActivityIndicator size="small" color="#1F6F50" style={{ marginTop: 8 }} />
            )}
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
              placeholderTextColor="#9AA69E"
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
                  (!emailInput.trim() || addingMember) && styles.disabledButton,
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

      <Modal visible={removeTarget !== null} animationType="fade" transparent>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.modalTitle}>Remove {removeTarget?.display_name}?</Text>
            <Text style={styles.modalBodyText}>
              They'll lose access to this circle and its games. Their existing history stays
              intact, and you can add them back anytime.
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={() => setRemoveTarget(null)}>
                <Text style={styles.modalCancelButtonText}>Never mind</Text>
              </Pressable>
              <Pressable
                style={[styles.modalDangerButton, removingUserId !== null && styles.disabledButton]}
                onPress={handleRemoveMember}
                disabled={removingUserId !== null}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {removingUserId !== null ? 'Removing...' : 'Yes, remove'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={leaveConfirmOpen} animationType="fade" transparent>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.modalTitle}>Leave this circle?</Text>
            <Text style={styles.modalBodyText}>
              You'll lose access to its games and reports. Someone in the circle can add you back
              anytime.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setLeaveConfirmOpen(false)}
              >
                <Text style={styles.modalCancelButtonText}>Never mind</Text>
              </Pressable>
              <Pressable
                style={[styles.modalDangerButton, leaving && styles.disabledButton]}
                onPress={handleLeaveCircle}
                disabled={leaving}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {leaving ? 'Leaving...' : 'Yes, leave'}
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
    padding: 16,
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
  },
  addMemberButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 16,
  },
  addMemberButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    fontSize: 15,
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
    fontWeight: '600',
  },
  leaveLink: {
    alignSelf: 'center',
    marginTop: 12,
  },
  leaveLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B3261E',
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
  modalBodyText: {
    fontSize: 14,
    color: '#6B7A73',
    marginBottom: 20,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
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
});
