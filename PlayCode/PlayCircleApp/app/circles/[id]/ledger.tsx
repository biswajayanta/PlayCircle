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
import { Circle, CircleLedger, CircleMember, LedgerEntry, UserMe } from '../../../lib/types';

function formatMoney(amount: string): string {
  return `₹${Number(amount).toFixed(2)}`;
}

function formatEntryDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

function entryPayer(e: LedgerEntry): string {
  return e.kind === 'expense' ? (e.paid_by_display_name ?? '—') : (e.from_display_name ?? '—');
}

function entryRecipient(e: LedgerEntry): string {
  return e.kind === 'expense' ? 'Group' : (e.to_display_name ?? '—');
}

export default function CircleLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [ledger, setLedger] = useState<CircleLedger | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [me, setMe] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recordOpen, setRecordOpen] = useState(false);
  const [fromUserId, setFromUserId] = useState<string | null>(null);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [circleResult, ledgerResult, membersResult, meResult] = await Promise.all([
        api.get<Circle>(`/circles/${id}`),
        api.get<CircleLedger>(`/circles/${id}/ledger`),
        api.get<CircleMember[]>(`/circles/${id}/members`),
        api.get<UserMe>('/me'),
      ]);
      setCircle(circleResult);
      setLedger(ledgerResult);
      setMembers(membersResult);
      setMe(meResult);
      setFromUserId((prev) => prev ?? meResult.user_id);
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

  function openRecord() {
    setFromUserId(me?.user_id ?? null);
    setToUserId(null);
    setAmount('');
    setNote('');
    setRecordOpen(true);
  }

  async function handleRecordTransfer() {
    if (!id || !fromUserId || !toUserId || !amount.trim() || fromUserId === toUserId) return;
    setRecording(true);
    try {
      await api.post(`/circles/${id}/transfers`, {
        from_user_id: fromUserId,
        to_user_id: toUserId,
        amount: amount.trim(),
        note: note.trim() || null,
      });
      setRecordOpen(false);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to record payment';
      showAlert('Could not record', message);
    } finally {
      setRecording(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !circle || !ledger) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Ledger unavailable'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `${circle.name} · Ledger` }} />

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Balances</Text>
          <Pressable onPress={openRecord}>
            <Text style={styles.actionLink}>+ Record a Payment</Text>
          </Pressable>
        </View>
        {ledger.balances.map((b) => {
          const value = Number(b.balance);
          return (
            <View key={b.user_id} style={styles.balanceRow}>
              <Text style={styles.balanceName}>{b.display_name}</Text>
              <Text
                style={[
                  styles.balanceAmount,
                  value > 0 && styles.balancePositive,
                  value < 0 && styles.balanceNegative,
                ]}
              >
                {value === 0
                  ? 'Settled up'
                  : value > 0
                    ? `Is owed ${formatMoney(b.balance)}`
                    : `Owes ${formatMoney(String(-value))}`}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Suggested settlements</Text>
        {ledger.fully_settled ? (
          <Text style={styles.emptyText}>Everyone's settled up. 🎉</Text>
        ) : (
          ledger.suggested_settlements.map((s, i) => (
            <Text key={i} style={styles.settlementLine}>
              <Text style={styles.settlementName}>{s.from_display_name}</Text> owes{' '}
              <Text style={styles.settlementName}>{s.to_display_name}</Text>{' '}
              <Text style={styles.settlementAmount}>{formatMoney(s.amount)}</Text>
            </Text>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>History</Text>
        {ledger.entries.length === 0 ? (
          <Text style={styles.emptyText}>Nothing recorded yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={[styles.tableRow, styles.tableHeaderRow]}>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.colDate]}>Date</Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.colName]}>Payer</Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.colName]}>
                  Recipient
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.colPurpose]}>
                  Purpose
                </Text>
                <Text style={[styles.tableCell, styles.tableHeaderCell, styles.colAmount]}>
                  Amount
                </Text>
              </View>
              {ledger.entries.map((e, i) => (
                <View
                  key={e.id}
                  style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
                >
                  <Text style={[styles.tableCell, styles.colDate]}>
                    {formatEntryDate(e.created_at)}
                  </Text>
                  <Text style={[styles.tableCell, styles.colName]} numberOfLines={1}>
                    {entryPayer(e)}
                  </Text>
                  <Text style={[styles.tableCell, styles.colName]} numberOfLines={1}>
                    {entryRecipient(e)}
                  </Text>
                  <Text style={[styles.tableCell, styles.colPurpose]} numberOfLines={2}>
                    {e.description}
                  </Text>
                  <Text style={[styles.tableCell, styles.colAmount, styles.tableAmountText]}>
                    {formatMoney(e.amount)}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      <Modal visible={recordOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>Record a payment</Text>

              <Text style={styles.fieldLabel}>Who paid?</Text>
              <FlatList
                data={members}
                keyExtractor={(m) => m.user_id}
                horizontal
                style={styles.chipRow}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.memberChip, fromUserId === item.user_id && styles.memberChipSelected]}
                    onPress={() => setFromUserId(item.user_id)}
                  >
                    <Text
                      style={[
                        styles.memberChipText,
                        fromUserId === item.user_id && styles.memberChipTextSelected,
                      ]}
                    >
                      {item.display_name}
                    </Text>
                  </Pressable>
                )}
              />

              <Text style={styles.fieldLabel}>Who received it?</Text>
              <FlatList
                data={members}
                keyExtractor={(m) => m.user_id}
                horizontal
                style={styles.chipRow}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.memberChip, toUserId === item.user_id && styles.memberChipSelected]}
                    onPress={() => setToUserId(item.user_id)}
                  >
                    <Text
                      style={[
                        styles.memberChipText,
                        toUserId === item.user_id && styles.memberChipTextSelected,
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
                placeholder="e.g. 250.00"
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                placeholderTextColor="#9AA69E"
                style={styles.input}
                placeholder="e.g. Settling up for court fees"
                value={note}
                onChangeText={setNote}
              />

              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelButton} onPress={() => setRecordOpen(false)}>
                  <Text style={styles.modalCancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalCreateButton,
                    (!fromUserId ||
                      !toUserId ||
                      fromUserId === toUserId ||
                      !amount.trim() ||
                      recording) &&
                      styles.disabledButton,
                  ]}
                  onPress={handleRecordTransfer}
                  disabled={
                    !fromUserId || !toUserId || fromUserId === toUserId || !amount.trim() || recording
                  }
                >
                  <Text style={styles.modalCreateButtonText}>
                    {recording ? 'Saving...' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
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
  actionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F6F50',
  },
  emptyText: {
    fontSize: 13,
    color: '#8A968F',
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
    color: '#8A968F',
  },
  balancePositive: {
    color: '#1F6F50',
  },
  balanceNegative: {
    color: '#B3261E',
  },
  settlementLine: {
    fontSize: 14,
    color: '#173A2E',
    marginBottom: 6,
  },
  settlementName: {
    fontWeight: '700',
  },
  settlementAmount: {
    fontWeight: '700',
    color: '#1F6F50',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  tableRowAlt: {
    backgroundColor: '#FAFBFA',
  },
  tableHeaderRow: {
    borderBottomWidth: 2,
    borderBottomColor: '#E7ECE9',
  },
  tableCell: {
    fontSize: 13,
    color: '#173A2E',
    paddingRight: 12,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A968F',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableAmountText: {
    fontWeight: '700',
  },
  colDate: {
    width: 72,
  },
  colName: {
    width: 100,
  },
  colPurpose: {
    width: 150,
  },
  colAmount: {
    width: 90,
    textAlign: 'right',
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
