import { router, useFocusEffect } from 'expo-router';
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

import { api, ApiError } from '../lib/api';
import { showAlert } from '../lib/alert';
import { useAuth } from '../lib/authContext';
import { Circle, UserMe } from '../lib/types';

export default function HomeScreen() {
  const { logout } = useAuth();
  const [me, setMe] = useState<UserMe | null>(null);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCircleName, setNewCircleName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [meResult, circlesResult] = await Promise.all([
        api.get<UserMe>('/me'),
        api.get<Circle[]>('/circles'),
      ]);
      setMe(meResult);
      setCircles(circlesResult);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.status}: ${err.message}`);
      } else {
        setError(
          'Could not reach the PlayCircle API. Is the backend running, and does EXPO_PUBLIC_API_URL point to it?'
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleCreateCircle() {
    const name = newCircleName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await api.post<Circle>('/circles', { name });
      setCircles((prev) => [created, ...prev]);
      setNewCircleName('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create circle';
      showAlert('Could not create circle', message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {me && (
        <View style={styles.greetingRow}>
          <Text style={styles.greeting}>Hey, {me.display_name} 👋</Text>
          <Pressable onPress={() => logout()}>
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.createRow}>
        <TextInput
        placeholderTextColor="#9AA69E"
          style={styles.input}
          placeholder="New circle name"
          value={newCircleName}
          onChangeText={setNewCircleName}
          onSubmitEditing={handleCreateCircle}
        />
        <Pressable
          style={[styles.createButton, creating && styles.createButtonDisabled]}
          onPress={handleCreateCircle}
          disabled={creating}
        >
          <Text style={styles.createButtonText}>{creating ? '...' : 'Create'}</Text>
        </Pressable>
      </View>

      <FlatList
        data={circles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            You're not in any circles yet. Create one above to get started.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push(`/circles/${item.id}`)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{item.my_role}</Text>
              </View>
            </View>
            <Text style={styles.cardSubtitle}>
              {item.member_count} {item.member_count === 1 ? 'member' : 'members'}
            </Text>
          </Pressable>
        )}
        onRefresh={load}
        refreshing={loading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F9F8',
    paddingHorizontal: 24,
  },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoutText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A968F',
  },
  greeting: {
    fontSize: 20,
    fontWeight: '600',
    color: '#173A2E',
  },
  createRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  createButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#173A2E',
  },
  cardSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B7A73',
  },
  roleBadge: {
    backgroundColor: '#E6F1EC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F6F50',
    textTransform: 'capitalize',
  },
  emptyText: {
    textAlign: 'center',
    color: '#6B7A73',
    marginTop: 40,
    fontSize: 14,
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
