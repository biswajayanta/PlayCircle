import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { Expense, ExpenseDetail, GameDetail, UserMe } from '../../../lib/types';

function formatMoney(amount: number | string, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${Number(amount).toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function GameExpensesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [me, setMe] = useState<UserMe | null>(null);
  const [game, setGame] = useState<GameDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payerId, setPayerId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<ExpenseDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [settlingUserId, setSettlingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [meResult, gameResult, expensesResult] = await Promise.all([
        api.get<UserMe>('/me'),
        api.get<GameDetail>(`/games/${id}`),
        api.get<Expense[]>(`/games/${id}/expenses`),
      ]);
      setMe(meResult);
      setGame(gameResult);
      setExpenses(expensesResult);
      setPayerId((prev) => prev ?? meResult.user_id);
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

  async function handleCreateExpense() {
    if (!id || !description.trim() || !amount.trim() || !payerId) return;
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      showAlert('Invalid amount', 'Enter a number greater than 0, e.g. 800.00');
      return;
    }
    setCreating(true);
    try {
      // No splits sent -> backend splits equally among the game's confirmed participants.
      const created = await api.post<ExpenseDetail>(`/games/${id}/expenses`, {
        description: description.trim(),
        amount: numericAmount.toFixed(2),
        paid_by_user_id: payerId,
      });
      setExpenses((prev) => [created, ...prev]);
      setDescription('');
      setAmount('');
      setPayerId(me?.user_id ?? null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add expense';
      showAlert('Could not add expense', message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleExpand(expenseId: string) {
    if (expandedId === expenseId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(expenseId);
    setExpandedLoading(true);
    try {
      const detail = await api.get<ExpenseDetail>(`/expenses/${expenseId}`);
      setExpandedDetail(detail);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load splits';
      showAlert('Could not load expense', message);
      setExpandedId(null);
    } finally {
      setExpandedLoading(false);
    }
  }

  async function handleSettle(expenseId: string, userId: string) {
    setSettlingUserId(userId);
    try {
      const updated = await api.patch<ExpenseDetail>(
        `/expenses/${expenseId}/splits/${userId}/settle`
      );
      setExpandedDetail(updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to settle split';
      showAlert('Could not settle', message);
    } finally {
      setSettlingUserId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error || !game) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Game not found'}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const isGameOwner = me?.user_id === game.creator_user_id;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Expenses' }} />

      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onRefresh={load}
        refreshing={loading}
        ListHeaderComponent={
          <View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total for this game</Text>
              <Text style={styles.summaryAmount}>{formatMoney(total, 'INR')}</Text>
            </View>

            {isGameOwner && (
              <View style={styles.composerCard}>
                <TextInput
                  style={styles.input}
                  placeholder="What was it for? e.g. Court booking"
                  value={description}
                  onChangeText={setDescription}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Amount, e.g. 800.00"
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.fieldLabel}>Who actually paid?</Text>
                <View style={styles.payerRow}>
                  {game.participants
                    .filter((p) => p.status === 'confirmed')
                    .map((p) => (
                      <Pressable
                        key={p.user_id}
                        style={[styles.payerChip, payerId === p.user_id && styles.payerChipSelected]}
                        onPress={() => setPayerId(p.user_id)}
                      >
                        <Text
                          style={[
                            styles.payerChipText,
                            payerId === p.user_id && styles.payerChipTextSelected,
                          ]}
                        >
                          {p.display_name}
                        </Text>
                      </Pressable>
                    ))}
                </View>
                <Text style={styles.hintText}>
                  Splits equally among the game's {game.confirmed_count} confirmed players.
                  {payerId && ` ${game.participants.find((p) => p.user_id === payerId)?.display_name}'s share is marked paid automatically.`}
                </Text>
                <Pressable
                  style={[
                    styles.addButton,
                    (!description.trim() || !amount.trim() || !payerId || creating) && styles.disabledButton,
                  ]}
                  onPress={handleCreateExpense}
                  disabled={!description.trim() || !amount.trim() || !payerId || creating}
                >
                  <Text style={styles.addButtonText}>
                    {creating ? 'Adding...' : 'Add Expense'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No expenses logged for this game yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.expenseCard}>
            <Pressable onPress={() => toggleExpand(item.id)}>
              <View style={styles.expenseHeader}>
                <Text style={styles.expenseDescription}>{item.description}</Text>
                <Text style={styles.expenseAmount}>
                  {formatMoney(item.amount, item.currency)}
                </Text>
              </View>
              <Text style={styles.expenseMeta}>
                Paid by {item.paid_by_display_name} · {timeAgo(item.created_at)}
              </Text>
            </Pressable>

            {expandedId === item.id && (
              <View style={styles.splitsBox}>
                {expandedLoading ? (
                  <ActivityIndicator size="small" color="#1F6F50" />
                ) : (
                  expandedDetail?.splits.map((split) => {
                    const canSettle = !split.is_settled && isGameOwner;
                    return (
                      <View key={split.id} style={styles.splitRow}>
                        <View style={styles.splitInfo}>
                          <Text style={styles.splitName}>{split.display_name}</Text>
                          <Text style={styles.splitAmount}>
                            {formatMoney(split.share_amount, item.currency)}
                          </Text>
                        </View>
                        {split.is_settled ? (
                          <View style={styles.settledBadge}>
                            <Text style={styles.settledBadgeText}>Paid</Text>
                          </View>
                        ) : canSettle ? (
                          <Pressable
                            style={styles.settleButton}
                            onPress={() => handleSettle(item.id, split.user_id)}
                            disabled={settlingUserId === split.user_id}
                          >
                            <Text style={styles.settleButtonText}>
                              {settlingUserId === split.user_id ? '...' : 'Mark paid'}
                            </Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.unpaidText}>Unpaid</Text>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 24,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  summaryCard: {
    backgroundColor: '#1F6F50',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  summaryLabel: {
    color: '#DCEEE5',
    fontSize: 13,
  },
  summaryAmount: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    marginTop: 2,
  },
  composerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
    marginTop: 2,
  },
  payerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  payerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D6DED9',
  },
  payerChipSelected: {
    backgroundColor: '#1F6F50',
    borderColor: '#1F6F50',
  },
  payerChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  payerChipTextSelected: {
    color: '#fff',
  },
  hintText: {
    fontSize: 12,
    color: '#8A968F',
  },
  addButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7A73',
    marginTop: 20,
    fontSize: 14,
  },
  expenseCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  expenseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expenseDescription: {
    fontSize: 15,
    fontWeight: '600',
    color: '#173A2E',
    flexShrink: 1,
    paddingRight: 8,
  },
  expenseAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#173A2E',
  },
  expenseMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#8A968F',
  },
  splitsBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E7ECE9',
    gap: 8,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  splitInfo: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'baseline',
  },
  splitName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  splitAmount: {
    fontSize: 13,
    color: '#6B7A73',
  },
  settledBadge: {
    backgroundColor: '#E6F1EC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  settledBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1F6F50',
  },
  settleButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  settleButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  unpaidText: {
    fontSize: 12,
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
});
