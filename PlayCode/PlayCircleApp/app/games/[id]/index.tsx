import { Stack, router, useLocalSearchParams } from 'expo-router';
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
import { GameDetail, Match, Post, PostDetail } from '../../../lib/types';

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
  const [posts, setPosts] = useState<Post[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const [gameResult, postsResult, matchesResult] = await Promise.all([
        api.get<GameDetail>(`/games/${id}`),
        api.get<Post[]>(`/games/${id}/posts`),
        api.get<Match[]>(`/games/${id}/matches`),
      ]);
      setGame(gameResult);
      setPosts(postsResult);
      setMatches(matchesResult);
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
                {game.format} · {game.confirmed_count}/{game.capacity} confirmed · {game.status}
              </Text>

              <Pressable
                style={styles.expensesLink}
                onPress={() => router.push(`/games/${id}/expenses`)}
              >
                <Text style={styles.expensesLinkText}>💰 View Expenses</Text>
              </Pressable>

              <Text style={styles.sectionLabel}>Players</Text>
              <View style={styles.participantsRow}>
                {game.participants.map((p) => (
                  <View key={p.user_id} style={styles.participantChip}>
                    <Text style={styles.participantName}>{p.display_name}</Text>
                    <Text style={styles.participantStatus}>{p.status}</Text>
                  </View>
                ))}
              </View>

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
                    <Text style={styles.matchScoreText}>
                      {m.score.team_1 ?? 0} – {m.score.team_2 ?? 0}
                    </Text>
                    <Text style={styles.matchStatusText}>{m.status}</Text>
                  </Pressable>
                ))
              )}
              <Pressable
                style={styles.startMatchButton}
                onPress={() => router.push(`/games/${id}/new-match`)}
              >
                <Text style={styles.startMatchButtonText}>+ Start Match</Text>
              </Pressable>
            </View>

            <View style={styles.composerCard}>
              <TextInput
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
  expensesLink: {
    marginTop: 12,
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
