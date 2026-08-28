import { Stack, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { UserPublic } from '../lib/types';

export default function SearchScreen() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearched(true);
    try {
      const result = await api.get<UserPublic[]>(
        `/users/search?q=${encodeURIComponent(query.trim())}`
      );
      setResults(result);
    } catch (err) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Find a Member' }} />

      {user && (
        <Pressable
          style={styles.ownProfileButton}
          onPress={() => router.push(`/profile/${user.user_id}`)}
        >
          <Text style={styles.ownProfileButtonText}>👤 View my profile</Text>
        </Pressable>
      )}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name..."
          placeholderTextColor="#9AA69E"
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <Pressable
          style={[styles.searchButton, (!query.trim() || searching) && styles.disabledButton]}
          onPress={handleSearch}
          disabled={!query.trim() || searching}
        >
          <Text style={styles.searchButtonText}>{searching ? '...' : 'Search'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.results}>
        {searching && <ActivityIndicator size="small" color="#1F6F50" style={{ marginTop: 20 }} />}

        {!searching && searched && results.length === 0 && (
          <Text style={styles.emptyText}>
            No public profiles matched "{query}". People with a private profile won't appear
            here.
          </Text>
        )}

        {results.map((r) => (
          <Pressable
            key={r.user_id}
            style={styles.resultRow}
            onPress={() => router.push(`/profile/${r.user_id}`)}
          >
            <View>
              <Text style={styles.resultName}>{r.display_name}</Text>
              {r.city && <Text style={styles.resultCity}>{r.city}</Text>}
            </View>
            <Text style={styles.resultArrow}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7FAF8', padding: 16 },
  ownProfileButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  ownProfileButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  searchRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D6DED9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  searchButton: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  disabledButton: { opacity: 0.5 },
  results: { paddingTop: 16, paddingBottom: 32 },
  emptyText: { fontSize: 13, color: '#8A968F', textAlign: 'center', marginTop: 20, lineHeight: 18 },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E7ECE9',
    padding: 12,
    marginBottom: 8,
  },
  resultName: { fontSize: 15, fontWeight: '700', color: '#173A2E' },
  resultCity: { fontSize: 12, color: '#6B7A73', marginTop: 2 },
  resultArrow: { fontSize: 20, color: '#B8C4BE' },
});
