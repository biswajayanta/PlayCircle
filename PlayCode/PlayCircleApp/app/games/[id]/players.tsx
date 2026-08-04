import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { CircleMember, GameDetail, UserMe } from '../../../lib/types';

export default function GamePlayersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [me, setMe] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<{
    user_id: string;
    display_name: string;
  } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [circleMembers, setCircleMembers] = useState<CircleMember[]>([]);
  const [loadingCircleMembers, setLoadingCircleMembers] = useState(false);
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [gameResult, meResult] = await Promise.all([
        api.get<GameDetail>(`/games/${id}`),
        api.get<UserMe>('/me'),
      ]);
      setGame(gameResult);
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

  async function handleRemove() {
    if (!id || !removeTarget) return;
    setRemovingId(removeTarget.user_id);
    try {
      await api.delete(`/games/${id}/participants/${removeTarget.user_id}`);
      setGame((prev) =>
        prev
          ? {
              ...prev,
              participants: prev.participants.filter(
                (p) => p.user_id !== removeTarget.user_id
              ),
              confirmed_count: prev.confirmed_count - 1,
            }
          : prev
      );
      setRemoveTarget(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to remove';
      showAlert('Could not remove', message);
    } finally {
      setRemovingId(null);
    }
  }

  async function openAddPlayer() {
    if (!game) return;
    setAddPlayerOpen(true);
    setLoadingCircleMembers(true);
    try {
      const members = await api.get<CircleMember[]>(`/circles/${game.circle_id}/members`);
      setCircleMembers(members);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load circle members';
      showAlert('Could not load members', message);
    } finally {
      setLoadingCircleMembers(false);
    }
  }

  async function handleAddPlayer(userId: string) {
    if (!id) return;
    setAddingPlayerId(userId);
    try {
      const updated = await api.post<GameDetail>(`/games/${id}/participants`, {
        user_id: userId,
      });
      setGame(updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add player';
      showAlert('Could not add player', message);
    } finally {
      setAddingPlayerId(null);
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

  const isGameOwner = me?.user_id === game.creator_user_id;
  const isActive = game.status !== 'completed' && game.status !== 'cancelled';

  function canManage(p: { user_id: string }): boolean {
    if (!isActive || game!.is_past) return false;
    if (p.user_id === game!.creator_user_id) return false;
    const isSelf = p.user_id === me?.user_id;
    return isSelf || isGameOwner;
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `${game.venue_name} · Players` }} />

      <Text style={styles.subtitle}>
        {game.confirmed_count} {game.confirmed_count === 1 ? 'player' : 'players'} joined
      </Text>

      {isGameOwner && isActive && !game.is_past && (
        <Pressable style={styles.addPlayerButton} onPress={openAddPlayer}>
          <Text style={styles.addPlayerButtonText}>+ Add Player</Text>
        </Pressable>
      )}

      <FlatList
        data={game.participants}
        keyExtractor={(p) => p.user_id}
        contentContainerStyle={styles.listContent}
        onRefresh={load}
        refreshing={loading}
        renderItem={({ item: p }) => (
          <View style={styles.playerRow}>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName}>{p.display_name}</Text>
              <Text style={styles.playerStatus}>{p.status}</Text>
            </View>
            {canManage(p) && (
              <Pressable
                onPress={() =>
                  setRemoveTarget({ user_id: p.user_id, display_name: p.display_name })
                }
                disabled={removingId === p.user_id}
                hitSlop={8}
              >
                <Text style={styles.removeX}>✕ Remove</Text>
              </Pressable>
            )}
          </View>
        )}
      />

      <Modal visible={removeTarget !== null} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {removeTarget?.user_id === me?.user_id
                ? 'Leave this game?'
                : `Remove ${removeTarget?.display_name}?`}
            </Text>
            <Text style={styles.modalBodyText}>
              Only possible since they haven't played a match or logged an expense in this game
              yet.
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={() => setRemoveTarget(null)}>
                <Text style={styles.modalCancelButtonText}>Never mind</Text>
              </Pressable>
              <Pressable
                style={[styles.modalDangerButton, removingId !== null && styles.disabledButton]}
                onPress={handleRemove}
                disabled={removingId !== null}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {removingId !== null ? 'Removing...' : 'Confirm'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={addPlayerOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a player</Text>
            {loadingCircleMembers ? (
              <ActivityIndicator color="#1F6F50" style={{ marginVertical: 20 }} />
            ) : (
              (() => {
                const alreadyIn = new Set(game.participants.map((p) => p.user_id));
                const eligible = circleMembers.filter((m) => !alreadyIn.has(m.user_id));
                if (eligible.length === 0) {
                  return (
                    <Text style={styles.modalBodyText}>
                      Everyone in this circle is already in this game.
                    </Text>
                  );
                }
                return (
                  <FlatList
                    data={eligible}
                    keyExtractor={(m) => m.user_id}
                    style={styles.addPlayerList}
                    renderItem={({ item }) => (
                      <View style={styles.addPlayerRow}>
                        <Text style={styles.addPlayerRowName}>{item.display_name}</Text>
                        <Pressable
                          style={[
                            styles.addButton,
                            addingPlayerId === item.user_id && styles.disabledButton,
                          ]}
                          onPress={() => handleAddPlayer(item.user_id)}
                          disabled={addingPlayerId !== null}
                        >
                          <Text style={styles.addButtonText}>
                            {addingPlayerId === item.user_id ? 'Adding...' : 'Add'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  />
                );
              })()
            )}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={() => setAddPlayerOpen(false)}>
                <Text style={styles.modalCancelButtonText}>Done</Text>
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
  addPlayerButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 16,
  },
  addPlayerButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  playerRow: {
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
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#173A2E',
  },
  playerStatus: {
    fontSize: 12,
    color: '#8A968F',
    textTransform: 'capitalize',
  },
  removeX: {
    fontSize: 13,
    color: '#B3261E',
    fontWeight: '600',
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
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
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
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    color: '#173A2E',
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
  addPlayerList: {
    maxHeight: 280,
    marginBottom: 12,
  },
  addPlayerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  addPlayerRowName: {
    fontSize: 14,
    color: '#173A2E',
  },
  addButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});
