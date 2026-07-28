import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from '../lib/authContext';

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const inAuthScreen = segments[0] === 'login' || segments[0] === 'signup';

  useEffect(() => {
    if (loading) return;
    if (!user && !inAuthScreen) {
      router.replace('/login');
    } else if (user && inAuthScreen) {
      router.replace('/');
    }
  }, [user, loading, inAuthScreen, router]);

  // Covers both the initial auth check and the brief moment between deciding
  // to redirect and the redirect actually completing — otherwise the
  // about-to-be-abandoned screen mounts for a tick and fires its own
  // (unauthenticated) data fetches.
  const shouldShowSpinner = loading || (!user && !inAuthScreen);

  if (shouldShowSpinner) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F9F8' }}>
        <ActivityIndicator size="large" color="#1F6F50" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1F6F50' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ title: 'My Circles' }} />
      <Stack.Screen name="circles/[id]" options={{ title: 'Circle' }} />
      <Stack.Screen name="games/[id]/index" options={{ title: 'Game' }} />
      <Stack.Screen name="games/[id]/expenses" options={{ title: 'Expenses' }} />
      <Stack.Screen name="games/[id]/new-match" options={{ title: 'New Match' }} />
      <Stack.Screen name="matches/[matchId]/index" options={{ title: 'Live Score' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
