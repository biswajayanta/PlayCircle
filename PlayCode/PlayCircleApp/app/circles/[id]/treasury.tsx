import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { Circle, CircleMember, Treasury, UserMe } from '../../../lib/types';

function formatMoney(amount: string): string {
  return `₹${Number(amount).toFixed(2)}`;
}

export default function CircleTreasuryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [me, setMe] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pickTreasurerOpen, setPickTreasurerOpen] = useState(false);
  const [settingTreasurerId, setSettingTreasurerId] = useState<string | null>(null);
  const [removingTreasurer, setRemovingTreasurer] = useState(false);
  const [confirmTransferTarget, setConfirmTransferTarget] = useState<{
    userId: string;
    displayName: string;
  } | null>(null);

  const [addContribOpen, setAddContribOpen] = useState(false);
  const [contribUserId, setContribUserId] = useState<string | null>(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribNote, setContribNote] = useState('');
  const [addingContrib, setAddingContrib] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [circleResult, treasuryResult, membersResult, meResult] = await Promise.all([
        api.get<Circle>(`/circles/${id}`),
        api.get<Treasury>(`/circles/${id}/treasury`),
        api.get<CircleMember[]>(`/circles/${id}/members`),
        api.get<UserMe>('/me'),
      ]);
      setCircle(circleResult);
      setTreasury(treasuryResult);
      setMembers(membersResult);
      setMe(meResult);
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

  function handlePickTreasurer(userId: string, displayName: string) {
    const hasOutstandingPool =
      treasury &&
      treasury.treasurer &&
      treasury.treasurer_pool_balance !== null &&
      Number(treasury.treasurer_pool_balance) !== 0;

    if (hasOutstandingPool) {
      // Changing an existing treasurer with money still outstanding — show
      // what's being handed over before actually doing it.
      setPickTreasurerOpen(false);
      setConfirmTransferTarget({ userId, displayName });
    } else {
      // First-time set, or an existing treasurer whose pool is already at
      // zero — nothing to transfer, nothing to confirm.
      handleSetTreasurer(userId);
    }
  }

  async function handleSetTreasurer(userId: string) {
    if (!id) return;
    setSettingTreasurerId(userId);
    try {
      await api.post(`/circles/${id}/treasurer`, { user_id: userId });
      setPickTreasurerOpen(false);
      setConfirmTransferTarget(null);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to set treasurer';
      showAlert('Could not set treasurer', message);
    } finally {
      setSettingTreasurerId(null);
    }
  }

  async function handleRemoveTreasurer() {
    if (!id) return;
    setRemovingTreasurer(true);
    try {
      await api.delete(`/circles/${id}/treasurer`);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to remove treasurer';
      showAlert('Could not remove treasurer', message);
    } finally {
      setRemovingTreasurer(false);
    }
  }

  async function handleAddContribution() {
    if (!id || !contribUserId || !contribAmount.trim()) return;
    setAddingContrib(true);
    try {
      await api.post(`/circles/${id}/advance-contributions`, {
        contributor_user_id: contribUserId,
        amount: contribAmount.trim(),
        note: contribNote.trim() || null,
      });
      setAddContribOpen(false);
      setContribUserId(null);
      setContribAmount('');
      setContribNote('');
      load();
      showAlert('Recorded', "Their kitty balance has been topped up.");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to record contribution';
      showAlert('Could not record', message);
    } finally {
      setAddingContrib(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !circle || !treasury) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Treasury unavailable'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const isOwner = circle.my_role === 'owner';
  const isTreasurerUser = treasury.treasurer?.user_id === me?.user_id;
  const canManageContributions = isOwner || isTreasurerUser;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `${circle.name} · Treasury` }} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Treasurer</Text>
        {treasury.treasurer ? (
          <View style={styles.treasurerRow}>
            <View>
              <Text style={styles.treasurerName}>{treasury.treasurer.display_name}</Text>
              {treasury.treasurer_pool_balance !== null && (
                <Text style={styles.poolBalanceText}>
                  Pool balance: {formatMoney(treasury.treasurer_pool_balance)}
                </Text>
              )}
            </View>
            {isOwner && (
              <Pressable onPress={handleRemoveTreasurer} disabled={removingTreasurer}>
                <Text style={styles.removeLink}>
                  {removingTreasurer ? 'Removing...' : '✕ Remove'}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <Text style={styles.emptyText}>No treasurer set for this circle.</Text>
        )}
        {isOwner && (
          <Pressable style={styles.actionButton} onPress={() => setPickTreasurerOpen(true)}>
            <Text style={styles.actionButtonText}>
              {treasury.treasurer ? 'Change Treasurer' : '+ Set Treasurer'}
            </Text>
          </Pressable>
        )}
        {!treasury.treasurer && (
          <Text style={styles.helpText}>
            Once a treasurer is set, members can hand them money in advance. When the
            treasurer pays for a game, anyone with enough balance is covered automatically —
            no need to individually pay up after every game.
          </Text>
        )}
      </View>

      {treasury.treasurer && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Balances</Text>
            {canManageContributions && (
              <Pressable onPress={() => setAddContribOpen(true)}>
                <Text style={styles.actionLink}>+ Add Contribution</Text>
              </Pressable>
            )}
          </View>
          {treasury.balances.length === 0 ? (
            <Text style={styles.emptyText}>No contributions recorded yet.</Text>
          ) : (
            treasury.balances.map((b) => (
              <View key={b.user_id} style={styles.balanceRow}>
                <Text style={styles.balanceName}>{b.display_name}</Text>
                <Text
                  style={[
                    styles.balanceAmount,
                    Number(b.balance) <= 0 && styles.balanceAmountZero,
                  ]}
                >
                  {formatMoney(b.balance)}
                </Text>
              </View>
            ))
          )}
        </View>
      )}

      {treasury.contributions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contribution history</Text>
          {treasury.contributions.map((c) => (
            <View key={c.id} style={styles.contribRow}>
              <View>
                <Text style={styles.contribName}>{c.contributor_display_name}</Text>
                {c.note && <Text style={styles.contribNote}>{c.note}</Text>}
              </View>
              <Text style={styles.contribAmount}>{formatMoney(c.amount)}</Text>
            </View>
          ))}
        </View>
      )}

      <Modal visible={pickTreasurerOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose a treasurer</Text>
            <FlatList
              data={members}
              keyExtractor={(m) => m.user_id}
              style={styles.pickerList}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.pickerRow}
                  onPress={() => handlePickTreasurer(item.user_id, item.display_name)}
                  disabled={settingTreasurerId !== null}
                >
                  <Text style={styles.pickerRowName}>{item.display_name}</Text>
                  {settingTreasurerId === item.user_id && (
                    <ActivityIndicator size="small" color="#1F6F50" />
                  )}
                </Pressable>
              )}
            />
            <Pressable
              style={styles.modalCancelButton}
              onPress={() => setPickTreasurerOpen(false)}
            >
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={confirmTransferTarget !== null} animationType="fade" transparent>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.modalTitle}>Transfer the treasury?</Text>
            <Text style={styles.modalBodyText}>
              {treasury.treasurer?.display_name}'s outstanding pool balance of{' '}
              {treasury.treasurer_pool_balance !== null &&
                formatMoney(treasury.treasurer_pool_balance)}{' '}
              will become {confirmTransferTarget?.displayName}'s responsibility going forward.
              Member balances themselves don't change — this is just who's holding the pool.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setConfirmTransferTarget(null)}
              >
                <Text style={styles.modalCancelButtonText}>Never mind</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalCreateButton,
                  settingTreasurerId !== null && styles.disabledButton,
                ]}
                onPress={() =>
                  confirmTransferTarget && handleSetTreasurer(confirmTransferTarget.userId)
                }
                disabled={settingTreasurerId !== null}
              >
                <Text style={styles.modalCreateButtonText}>
                  {settingTreasurerId !== null ? 'Transferring...' : 'Confirm transfer'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={addContribOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a contribution</Text>

            <Text style={styles.fieldLabel}>Who contributed?</Text>
            <FlatList
              data={members}
              keyExtractor={(m) => m.user_id}
              horizontal
              style={styles.chipRow}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.memberChip,
                    contribUserId === item.user_id && styles.memberChipSelected,
                  ]}
                  onPress={() => setContribUserId(item.user_id)}
                >
                  <Text
                    style={[
                      styles.memberChipText,
                      contribUserId === item.user_id && styles.memberChipTextSelected,
                    ]}
                  >
                    {item.display_name}
                  </Text>
                </Pressable>
              )}
            />

            <Text style={styles.fieldLabel}>Amount</Text>
            <TextInput
              placeholderTextColor="#9AA69E"
              style={styles.input}
              placeholder="e.g. 1000.00"
              value={contribAmount}
              onChangeText={setContribAmount}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Note (optional)</Text>
            <TextInput
              placeholderTextColor="#9AA69E"
              style={styles.input}
              placeholder="e.g. Season advance"
              value={contribNote}
              onChangeText={setContribNote}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setAddContribOpen(false)}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalCreateButton,
                  (!contribUserId || !contribAmount.trim() || addingContrib) &&
                    styles.disabledButton,
                ]}
                onPress={handleAddContribution}
                disabled={!contribUserId || !contribAmount.trim() || addingContrib}
              >
                <Text style={styles.modalCreateButtonText}>
                  {addingContrib ? 'Saving...' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 24,
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
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#173A2E',
    marginBottom: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  treasurerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  treasurerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#173A2E',
  },
  poolBalanceText: {
    fontSize: 13,
    color: '#8A968F',
    marginTop: 2,
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
  removeLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B3261E',
  },
  emptyText: {
    fontSize: 13,
    color: '#8A968F',
    marginBottom: 12,
  },
  helpText: {
    fontSize: 12,
    color: '#8A968F',
    marginTop: 10,
    lineHeight: 18,
  },
  actionButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  actionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F6F50',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  balanceName: {
    fontSize: 14,
    color: '#173A2E',
  },
  balanceAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F6F50',
  },
  balanceAmountZero: {
    color: '#8A968F',
  },
  contribRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  contribName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#173A2E',
  },
  contribNote: {
    fontSize: 12,
    color: '#8A968F',
    marginTop: 1,
  },
  contribAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#173A2E',
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
  pickerList: {
    maxHeight: 320,
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  pickerRowName: {
    fontSize: 15,
    color: '#173A2E',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
    marginTop: 12,
    marginBottom: 6,
  },
  chipRow: {
    maxHeight: 44,
  },
  memberChip: {
    backgroundColor: '#F1F4F2',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  memberChipSelected: {
    backgroundColor: '#1F6F50',
  },
  memberChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  memberChipTextSelected: {
    color: '#fff',
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
  disabledButton: {
    opacity: 0.5,
  },
});
