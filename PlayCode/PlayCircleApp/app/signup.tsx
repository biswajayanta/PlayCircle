import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '../lib/api';
import { showAlert } from '../lib/alert';
import { useAuth } from '../lib/authContext';

export default function SignupScreen() {
  const { signup } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = displayName.trim() && email.trim() && password.length >= 8;

  async function handleSignup() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await signup(email.trim(), password, displayName.trim(), city.trim() || undefined);
      router.replace('/');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not create account';
      showAlert('Signup failed', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join PlayCircle</Text>
      <Text style={styles.subtitle}>Create an account to organize games with your circle</Text>

      <TextInput
        style={styles.input}
        placeholder="Your name"
        value={displayName}
        onChangeText={setDisplayName}
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password (min 8 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TextInput
        style={styles.input}
        placeholder="City (optional)"
        value={city}
        onChangeText={setCity}
        onSubmitEditing={handleSignup}
      />

      <Pressable
        style={[styles.button, (!canSubmit || submitting) && styles.disabled]}
        onPress={handleSignup}
        disabled={!canSubmit || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Create Account</Text>
        )}
      </Pressable>

      <View style={styles.footerRow}>
        <Text style={styles.footerText}>Already have an account? </Text>
        <Link href="/login" replace>
          <Text style={styles.footerLink}>Log in</Text>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9F8',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1F6F50',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7A73',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 28,
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
  },
  button: {
    backgroundColor: '#1F6F50',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerText: {
    color: '#6B7A73',
    fontSize: 14,
  },
  footerLink: {
    color: '#1F6F50',
    fontWeight: '600',
    fontSize: 14,
  },
});
