import { usePathname } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, ApiError } from '../lib/api';
import { emitDataChanged } from '../lib/assistantEvents';
import {
  AssistantChatResponse,
  AssistantConfirmResponse,
  AssistantContext,
  AssistantPendingAction,
} from '../lib/types';

// What's actually rendered as chat bubbles on screen — separate from the
// raw history blob sent to the backend, which the frontend never needs to
// interpret, only store and echo back.
interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Infers which circle/game/match the user is currently looking at from the
// URL path itself. Deliberately NOT using useLocalSearchParams() here —
// this component is mounted as a sibling of the Stack navigator in
// _layout.tsx, not nested inside whichever screen is actually active, and
// route-scoped params don't resolve correctly from that position. Reading
// the pathname directly works regardless of where in the tree this sits,
// since it reflects the router's overall navigation state, not a specific
// screen's own param scope.
function useAssistantContext(): AssistantContext {
  const pathname = usePathname();

  const matchMatch = pathname.match(/\/matches\/([^/]+)/);
  if (matchMatch) return { match_id: matchMatch[1] };

  const gameMatch = pathname.match(/\/games\/([^/]+)/);
  if (gameMatch) return { game_id: gameMatch[1] };

  const circleMatch = pathname.match(/\/circles\/([^/]+)/);
  if (circleMatch) return { circle_id: circleMatch[1] };

  return {};
}

export default function AssistantBubble() {
  const context = useAssistantContext();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [rawHistory, setRawHistory] = useState<Record<string, unknown>[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingAction, setPendingAction] = useState<AssistantPendingAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  function scrollToBottom() {
    // Deferred a tick so it runs after the new message actually renders.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setPendingAction(null);
    setSending(true);
    scrollToBottom();

    try {
      // Deliberately NOT truncating rawHistory here — naively slicing a
      // list containing paired tool-call/tool-result messages risks
      // separating a result from its call, which breaks the API request
      // the same way an unconfirmed pending action's tool call would.
      // Fine for now given realistic session lengths; worth a smarter
      // (boundary-aware) truncation strategy if conversations get long.
      const resp = await api.post<AssistantChatResponse>('/assistant/chat', {
        message: text,
        history: rawHistory,
        context: { ...context, match_id: context.match_id ?? activeMatchId ?? undefined },
      });
      setRawHistory(resp.messages);
      setMessages((prev) => [...prev, { role: 'assistant', content: resp.reply }]);
      setPendingAction(resp.pending_action);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong';
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${message}` }]);
    } finally {
      setSending(false);
      scrollToBottom();
    }
  }

  async function handleConfirm() {
    if (!pendingAction || confirming) return;
    setConfirming(true);
    try {
      const resp = await api.post<AssistantConfirmResponse>('/assistant/confirm', {
        tool_name: pendingAction.tool_name,
        arguments: pendingAction.arguments,
      });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: resp.success ? resp.reply : `⚠️ ${resp.reply}` },
      ]);

      // If this action just created or targeted a match, remember its ID
      // for this session — future messages like "give 2 points to Sni"
      // should default to it without the model having to dig the ID back
      // out of conversation text.
      const resultId = resp.result?.id;
      if (resp.success && pendingAction.tool_name === 'start_match' && typeof resultId === 'string') {
        setActiveMatchId(resultId);
      }
      if (typeof pendingAction.arguments.match_id === 'string') {
        setActiveMatchId(pendingAction.arguments.match_id);
      }

      // Tell any currently-mounted screen showing this entity to refresh
      // itself — otherwise a confirmed action only shows up once the user
      // navigates away and back, since the screen and this bubble are
      // entirely independent components with their own separate state.
      if (resp.success) {
        if (pendingAction.tool_name === 'create_game' && typeof resultId === 'string') {
          emitDataChanged({ entityType: 'game', entityId: resultId });
          if (typeof pendingAction.arguments.circle_id === 'string') {
            emitDataChanged({ entityType: 'circle', entityId: pendingAction.arguments.circle_id });
          }
        } else if (pendingAction.tool_name === 'start_match') {
          if (typeof resultId === 'string') {
            emitDataChanged({ entityType: 'match', entityId: resultId });
          }
          if (typeof pendingAction.arguments.game_id === 'string') {
            emitDataChanged({ entityType: 'game', entityId: pendingAction.arguments.game_id });
          }
        } else if (
          ['record_point', 'undo_last_point', 'conclude_match'].includes(pendingAction.tool_name) &&
          typeof pendingAction.arguments.match_id === 'string'
        ) {
          emitDataChanged({ entityType: 'match', entityId: pendingAction.arguments.match_id });
        }
      }

      // The /confirm endpoint doesn't return an updated raw history, so
      // append a summary ourselves — but critically, include the actual
      // result data (e.g. the new match's real ID), not just human-readable
      // description text. Without the real ID here, the next turn has
      // nothing concrete to act on and can't reliably reference what this
      // action just created.
      setRawHistory((prev) => [
        ...prev,
        {
          role: 'system',
          content: resp.success
            ? `(Internal note, not shown to the user: the action "${pendingAction.description}" was just completed. Result: ${JSON.stringify(resp.result)})`
            : `(Internal note, not shown to the user: the action "${pendingAction.description}" failed — ${resp.reply})`,
        },
      ]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'That action failed';
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${message}` }]);
    } finally {
      setConfirming(false);
      setPendingAction(null);
      scrollToBottom();
    }
  }

  function handleCancel() {
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Okay, cancelled.' }]);
    setRawHistory((prev) => [
      ...prev,
      {
        role: 'system',
        content: `(Internal note, not shown to the user: the user cancelled this proposed action — ${pendingAction?.description})`,
      },
    ]);
    setPendingAction(null);
    scrollToBottom();
  }

  return (
    <>
      <Pressable style={styles.fab} onPress={() => setOpen(true)}>
        <Text style={styles.fabIcon}>💬</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.panel}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Assistant</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              style={styles.messageList}
              contentContainerStyle={styles.messageListContent}
              onContentSizeChange={scrollToBottom}
            >
              {messages.length === 0 && (
                <Text style={styles.emptyHint}>
                  Ask me to create a game, start a match, record a point, or wrap one up —
                  I'll always check with you before anything actually happens.
                </Text>
              )}
              {messages.map((m, i) => (
                <View
                  key={i}
                  style={[
                    styles.bubble,
                    m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                  ]}
                >
                  <Text
                    style={m.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant}
                  >
                    {m.content}
                  </Text>
                </View>
              ))}
              {sending && (
                <View style={[styles.bubble, styles.bubbleAssistant]}>
                  <ActivityIndicator size="small" color="#1F6F50" />
                </View>
              )}
            </ScrollView>

            {pendingAction && (
              <View style={styles.confirmBar}>
                <Text style={styles.confirmText}>{pendingAction.description}</Text>
                <View style={styles.confirmButtons}>
                  <Pressable
                    style={styles.cancelActionButton}
                    onPress={handleCancel}
                    disabled={confirming}
                  >
                    <Text style={styles.cancelActionButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.confirmActionButton, confirming && styles.disabledButton]}
                    onPress={handleConfirm}
                    disabled={confirming}
                  >
                    <Text style={styles.confirmActionButtonText}>
                      {confirming ? 'Working...' : 'Confirm'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={
                  pendingAction ? 'Confirm or cancel above first...' : 'Ask me anything...'
                }
                placeholderTextColor="#9AA69E"
                value={input}
                onChangeText={setInput}
                onSubmitEditing={handleSend}
                editable={!sending && !pendingAction}
              />
              <Pressable
                style={[
                  styles.sendButton,
                  (sending || !input.trim() || !!pendingAction) && styles.disabledButton,
                ]}
                onPress={handleSend}
                disabled={sending || !input.trim() || !!pendingAction}
              >
                <Text style={styles.sendButtonText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
    bottom: 80,
    right: 12,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1F6F50',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabIcon: {
    fontSize: 24,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '75%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E7ECE9',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#173A2E',
  },
  closeText: {
    fontSize: 18,
    color: '#6B7A73',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
    gap: 10,
  },
  emptyHint: {
    fontSize: 13,
    color: '#8A968F',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#1F6F50',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0F4F1',
  },
  bubbleTextUser: {
    color: '#fff',
    fontSize: 14,
  },
  bubbleTextAssistant: {
    color: '#173A2E',
    fontSize: 14,
  },
  confirmBar: {
    borderTopWidth: 1,
    borderTopColor: '#E7ECE9',
    backgroundColor: '#FFF9EC',
    padding: 12,
  },
  confirmText: {
    fontSize: 13,
    color: '#173A2E',
    marginBottom: 10,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelActionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D6DED9',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  cancelActionButtonText: {
    color: '#173A2E',
    fontWeight: '600',
    fontSize: 13,
  },
  confirmActionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1F6F50',
    alignItems: 'center',
  },
  confirmActionButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  disabledButton: {
    opacity: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E7ECE9',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
