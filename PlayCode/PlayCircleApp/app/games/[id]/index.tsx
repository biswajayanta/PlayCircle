import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../../../lib/alert';
import { api, ApiError } from '../../../lib/api';
import { subscribeToDataChanged } from '../../../lib/assistantEvents';
import { GameDetail, Match, Post, PostDetail, UserMe } from '../../../lib/types';

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

export default function GameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [me, setMe] = useState<UserMe | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDateInput, setRescheduleDateInput] = useState('');
  const [rescheduleTimeInput, setRescheduleTimeInput] = useState('');
  const [showReschedDatePicker, setShowReschedDatePicker] = useState(false);
  const [showReschedTimePicker, setShowReschedTimePicker] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [likingId, setLikingId] = useState<string | null>(null);

  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<PostDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commenting, setCommenting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [gameResult, postsResult, matchesResult, meResult] = await Promise.all([
        api.get<GameDetail>(`/games/${id}`),
        api.get<Post[]>(`/games/${id}/posts`),
        api.get<Match[]>(`/games/${id}/matches`),
        api.get<UserMe>('/me'),
      ]);
      setGame(gameResult);
      setPosts(postsResult);
      setMatches(matchesResult);
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

  useEffect(() => {
    return subscribeToDataChanged((event) => {
      if (
        (event.entityType === 'game' && event.entityId === id) ||
        // A match belonging to this game changing (started, scored,
        // concluded) also affects what this screen shows — the matches
        // list and the game's own status/counts.
        (event.entityType === 'match' && matches.some((m) => m.id === event.entityId))
      ) {
        load();
      }
    });
  }, [id, matches, load]);

  // Android dismisses the picker itself and reports event.type; iOS keeps it
  // open inline, so we only close it here on Android after a real selection.
  function onReschedDateChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowReschedDatePicker(false);
    if (event.type === 'set' && selected) setRescheduleDateInput(formatDateInput(selected));
  }

  function onReschedTimeChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowReschedTimePicker(false);
    if (event.type === 'set' && selected) setRescheduleTimeInput(formatTimeInput(selected));
  }

  async function handleReschedule() {
    if (!id || !rescheduleDateInput || !rescheduleTimeInput) return;
    const newDate = new Date(`${rescheduleDateInput}T${rescheduleTimeInput}`);
    if (Number.isNaN(newDate.getTime())) {
      showAlert('Invalid date', 'Please pick a valid date and time.');
      return;
    }
    setRescheduling(true);
    try {
      const updated = await api.patch<GameDetail>(`/games/${id}/reschedule`, {
        scheduled_at: newDate.toISOString(),
      });
      setGame(updated);
      setRescheduleOpen(false);
      setRescheduleDateInput('');
      setRescheduleTimeInput('');
      showAlert('Rescheduled', 'The game has been moved to the new time.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to reschedule';
      showAlert('Could not reschedule', message);
    } finally {
      setRescheduling(false);
    }
  }

  async function handleCancel() {
    if (!id) return;
    setCancelling(true);
    try {
      const updated = await api.post<GameDetail>(`/games/${id}/cancel`);
      setGame(updated);
      setCancelConfirmOpen(false);
      showAlert('Game cancelled', 'This game has been cancelled.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to cancel';
      setCancelConfirmOpen(false);
      showAlert('Could not cancel', message);
    } finally {
      setCancelling(false);
    }
  }

  async function handlePost() {
    if (!id || !caption.trim()) return;
    setPosting(true);
    try {
      const created = await api.post<PostDetail>('/posts', {
        game_id: id,
        caption: caption.trim(),
      });
      setPosts((prev) => [created, ...prev]);
      setCaption('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to post';
      showAlert('Could not post', message);
    } finally {
      setPosting(false);
    }
  }

  async function handleToggleLike(post: Post) {
    setLikingId(post.id);
    try {
      const updated = post.liked_by_me
        ? await api.delete<Post>(`/posts/${post.id}/like`)
        : await api.post<Post>(`/posts/${post.id}/like`);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? updated : p)));
      if (expandedPostId === post.id && expandedDetail) {
        setExpandedDetail({ ...expandedDetail, ...updated });
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update like';
      showAlert('Could not update like', message);
    } finally {
      setLikingId(null);
    }
  }

  async function toggleExpand(postId: string) {
    if (expandedPostId === postId) {
      setExpandedPostId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedPostId(postId);
    setExpandedLoading(true);
    try {
      const detail = await api.get<PostDetail>(`/posts/${postId}`);
      setExpandedDetail(detail);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load comments';
      showAlert('Could not load comments', message);
      setExpandedPostId(null);
    } finally {
      setExpandedLoading(false);
    }
  }

  async function handleAddComment(postId: string) {
    if (!commentDraft.trim()) return;
    setCommenting(true);
    try {
      const updated = await api.post<PostDetail>(`/posts/${postId}/comments`, {
        body: commentDraft.trim(),
      });
      setExpandedDetail(updated);
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, comment_count: updated.comment_count } : p))
      );
      setCommentDraft('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to add comment';
      showAlert('Could not comment', message);
    } finally {
      setCommenting(false);
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: game.venue_name }} />

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onRefresh={load}
        refreshing={loading}
        ListHeaderComponent={
          <View>
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>{game.venue_name}</Text>
              <Text style={styles.infoSubtitle}>{formatScheduledAt(game.scheduled_at)}</Text>
              <Text style={styles.infoMeta}>
                {game.confirmed_count} {game.confirmed_count === 1 ? 'player' : 'players'} joined · {game.status}
                {game.is_past && isActive ? ' · Past' : ''}
              </Text>

              <View style={styles.linkRow}>
                <Pressable
                  style={styles.expensesLink}
                  onPress={() => router.push(`/games/${id}/players`)}
                >
                  <Text style={styles.expensesLinkText}>👥 View Players</Text>
                </Pressable>
                <Pressable
                  style={styles.expensesLink}
                  onPress={() => router.push(`/games/${id}/expenses`)}
                >
                  <Text style={styles.expensesLinkText}>💰 View Expenses</Text>
                </Pressable>
                <Pressable
                  style={styles.expensesLink}
                  onPress={() => router.push(`/games/${id}/report`)}
                >
                  <Text style={styles.expensesLinkText}>📊 View Report</Text>
                </Pressable>
              </View>

              {isGameOwner && isActive && (
                <View style={styles.linkRow}>
                  {!game.is_past && matches.length === 0 && (
                    <Pressable
                      style={styles.expensesLink}
                      onPress={() => {
                        const current = new Date(game.scheduled_at);
                        setRescheduleDateInput(formatDateInput(current));
                        setRescheduleTimeInput(formatTimeInput(current));
                        setRescheduleOpen(true);
                      }}
                    >
                      <Text style={styles.expensesLinkText}>🗓️ Reschedule</Text>
                    </Pressable>
                  )}
                  {matches.length === 0 && !(game.has_expenses && !game.all_settled) && (
                    <Pressable
                      style={styles.cancelLink}
                      onPress={() => setCancelConfirmOpen(true)}
                    >
                      <Text style={styles.cancelLinkText}>✕ Cancel game</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <Text style={styles.sectionLabel}>Matches</Text>
              {matches.length === 0 ? (
                <Text style={styles.noMatchesText}>No matches recorded yet.</Text>
              ) : (
                matches.map((m) => (
                  <Pressable
                    key={m.id}
                    style={styles.matchRow}
                    onPress={() => router.push(`/matches/${m.id}`)}
                  >
                    <Text style={styles.matchFormatText}>{m.format}</Text>
                    <Text style={styles.matchScoreText}>
                      {m.score.team_1 ?? 0} – {m.score.team_2 ?? 0}
                    </Text>
                    <Text style={styles.matchStatusText}>{m.status}</Text>
                  </Pressable>
                ))
              )}
              {isActive && !game.is_past && (
                <Pressable
                  style={[
                    styles.startMatchButton,
                    game.confirmed_count < 2 && styles.disabledButton,
                  ]}
                  onPress={() => {
                    if (game.confirmed_count < 2) return;
                    router.push(`/games/${id}/new-match`);
                  }}
                  disabled={game.confirmed_count < 2}
                >
                  <Text style={styles.startMatchButtonText}>
                    {game.confirmed_count < 2 ? 'Need 2+ players to start' : '+ Start Match'}
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={styles.composerCard}>
              <TextInput
        placeholderTextColor="#9AA69E"
                style={styles.composerInput}
                placeholder="Share something about this game..."
                value={caption}
                onChangeText={setCaption}
                multiline
              />
              <Pressable
                style={[styles.postButton, (!caption.trim() || posting) && styles.disabledButton]}
                onPress={handlePost}
                disabled={!caption.trim() || posting}
              >
                <Text style={styles.postButtonText}>{posting ? 'Posting...' : 'Post'}</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No posts yet. Be the first to share something.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.postCard}>
            <Text style={styles.postAuthor}>
              {item.author_display_name}{' '}
              <Text style={styles.postTime}>· {timeAgo(item.created_at)}</Text>
            </Text>
            {item.caption && <Text style={styles.postCaption}>{item.caption}</Text>}

            <View style={styles.postActions}>
              <Pressable
                onPress={() => handleToggleLike(item)}
                disabled={likingId === item.id}
                style={styles.postActionButton}
              >
                <Text style={[styles.postActionText, item.liked_by_me && styles.likedText]}>
                  {item.liked_by_me ? '♥' : '♡'} {item.like_count}
                </Text>
              </Pressable>
              <Pressable onPress={() => toggleExpand(item.id)} style={styles.postActionButton}>
                <Text style={styles.postActionText}>💬 {item.comment_count}</Text>
              </Pressable>
            </View>

            {expandedPostId === item.id && (
              <View style={styles.commentsBox}>
                {expandedLoading ? (
                  <ActivityIndicator size="small" color="#1F6F50" />
                ) : (
                  <>
                    {expandedDetail?.comments.map((c) => (
                      <View key={c.id} style={styles.commentRow}>
                        <Text style={styles.commentAuthor}>{c.author_display_name}</Text>
                        <Text style={styles.commentBody}>{c.body}</Text>
                      </View>
                    ))}
                    {expandedDetail?.comments.length === 0 && (
                      <Text style={styles.noCommentsText}>No comments yet.</Text>
                    )}
                    <View style={styles.commentInputRow}>
                      <TextInput
        placeholderTextColor="#9AA69E"
                        style={styles.commentInput}
                        placeholder="Add a comment..."
                        value={commentDraft}
                        onChangeText={setCommentDraft}
                        onSubmitEditing={() => handleAddComment(item.id)}
                      />
                      <Pressable
                        onPress={() => handleAddComment(item.id)}
                        disabled={commenting || !commentDraft.trim()}
                      >
                        <Text style={styles.commentSendText}>
                          {commenting ? '...' : 'Send'}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        )}
      />

      <Modal visible={rescheduleOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reschedule game</Text>
            <Text style={styles.fieldLabel}>Date</Text>
            {Platform.OS === 'web' ? (
              React.createElement('input', {
                type: 'date',
                value: rescheduleDateInput,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  setRescheduleDateInput(e.target.value),
                style: webDateInputStyle,
              })
            ) : (
              <>
                <Pressable style={styles.input} onPress={() => setShowReschedDatePicker(true)}>
                  <Text style={rescheduleDateInput ? styles.pickerValueText : styles.pickerPlaceholderText}>
                    {rescheduleDateInput || 'Choose a date'}
                  </Text>
                </Pressable>
                {showReschedDatePicker && (
                  <DateTimePicker
                    value={rescheduleDateInput ? new Date(`${rescheduleDateInput}T00:00:00`) : new Date()}
                    mode="date"
                    display="default"
                    onChange={onReschedDateChange}
                  />
                )}
              </>
            )}

            <Text style={styles.fieldLabel}>Time</Text>
            {Platform.OS === 'web' ? (
              React.createElement('input', {
                type: 'time',
                value: rescheduleTimeInput,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  setRescheduleTimeInput(e.target.value),
                style: webDateInputStyle,
              })
            ) : (
              <>
                <Pressable style={styles.input} onPress={() => setShowReschedTimePicker(true)}>
                  <Text style={rescheduleTimeInput ? styles.pickerValueText : styles.pickerPlaceholderText}>
                    {rescheduleTimeInput || 'Choose a time'}
                  </Text>
                </Pressable>
                {showReschedTimePicker && (
                  <DateTimePicker
                    value={rescheduleTimeInput ? new Date(`2000-01-01T${rescheduleTimeInput}:00`) : new Date()}
                    mode="time"
                    display="default"
                    onChange={onReschedTimeChange}
                  />
                )}
              </>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setRescheduleOpen(false)}
              >
                <Text style={styles.modalCancelButtonText}>Back</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmButton,
                  (!rescheduleDateInput || !rescheduleTimeInput || rescheduling) && styles.disabledButton,
                ]}
                onPress={handleReschedule}
                disabled={!rescheduleDateInput || !rescheduleTimeInput || rescheduling}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {rescheduling ? 'Saving...' : 'Save new time'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={cancelConfirmOpen} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cancel this game?</Text>
            <Text style={styles.modalBodyText}>
              This can only be done if no matches have been played and all
              expenses in this game are settled. This can't be undone.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setCancelConfirmOpen(false)}
              >
                <Text style={styles.modalCancelButtonText}>Never mind</Text>
              </Pressable>
              <Pressable
                style={[styles.modalDangerButton, cancelling && styles.disabledButton]}
                onPress={handleCancel}
                disabled={cancelling}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {cancelling ? 'Cancelling...' : 'Yes, cancel it'}
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
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#173A2E',
  },
  infoSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6B7A73',
  },
  infoMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#8A968F',
    textTransform: 'capitalize',
  },
  sectionLabel: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  addPlayerLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F6F50',
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
  addPlayerName: {
    fontSize: 14,
    color: '#173A2E',
  },
  addPlayerButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  addPlayerButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  expensesLink: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F4F2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  expensesLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F6F50',
  },
  cancelLink: {
    alignSelf: 'flex-start',
    backgroundColor: '#FDECEA',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B3261E',
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
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1F6F50',
    alignItems: 'center',
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
  input: {
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    marginBottom: 12,
    justifyContent: 'center',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7A73',
    marginBottom: 6,
  },
  pickerValueText: {
    fontSize: 15,
    color: '#173A2E',
  },
  pickerPlaceholderText: {
    fontSize: 15,
    color: '#9AA69E',
  },
  noMatchesText: {
    fontSize: 13,
    color: '#8A968F',
  },
  matchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F2',
  },
  matchFormatText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7A73',
    textTransform: 'capitalize',
  },
  matchScoreText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#173A2E',
  },
  matchStatusText: {
    fontSize: 12,
    color: '#8A968F',
    textTransform: 'capitalize',
  },
  startMatchButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  startMatchButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  participantsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  participantChip: {
    backgroundColor: '#F1F4F2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  participantRemoveX: {
    fontSize: 12,
    color: '#B3261E',
    fontWeight: '700',
  },
  participantName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#173A2E',
  },
  participantStatus: {
    fontSize: 11,
    color: '#8A968F',
    textTransform: 'capitalize',
  },
  composerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  composerInput: {
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  postButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  postButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7A73',
    marginTop: 20,
    fontSize: 14,
  },
  postCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  postAuthor: {
    fontSize: 14,
    fontWeight: '600',
    color: '#173A2E',
  },
  postTime: {
    fontWeight: '400',
    color: '#8A968F',
  },
  postCaption: {
    marginTop: 6,
    fontSize: 14,
    color: '#334138',
  },
  postActions: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 10,
  },
  postActionButton: {
    paddingVertical: 4,
  },
  postActionText: {
    fontSize: 13,
    color: '#6B7A73',
  },
  likedText: {
    color: '#C1443A',
    fontWeight: '600',
  },
  commentsBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E7ECE9',
  },
  commentRow: {
    marginBottom: 6,
  },
  commentAuthor: {
    fontSize: 12,
    fontWeight: '600',
    color: '#173A2E',
  },
  commentBody: {
    fontSize: 13,
    color: '#334138',
  },
  noCommentsText: {
    fontSize: 13,
    color: '#8A968F',
    marginBottom: 6,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  commentSendText: {
    color: '#1F6F50',
    fontWeight: '600',
    fontSize: 13,
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
