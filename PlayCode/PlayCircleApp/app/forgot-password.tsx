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

import { ApiError, api } from '../lib/api';
import { showAlert } from '../lib/alert';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSubmitted(true);
    } catch (err) {
      // The backend always returns success here regardless of whether the
      // email exists, so a thrown error means something else went wrong
      // (network, server down, etc.) — worth surfacing.
      const message = err instanceof ApiError ? err.message : 'Something went wrong';
      showAlert('Could not send reset request', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset your password</Text>

      {submitted ? (
        <>
          <Text style={styles.confirmationText}>
            If that email is registered, a reset code has been generated. Ask
            whoever manages PlayCircle for your reset code, then continue
            below.
          </Text>
          <Pressable style={styles.button} onPress={() => router.push('/reset-password')}>
            <Text style={styles.buttonText}>I have my reset code</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.subtitle}>
            Enter the email on your account and we'll generate a reset code.
          </Text>
          <TextInput
        placeholderTextColor="#9AA69E"
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            onSubmitEditing={handleSubmit}
          />
          <Pressable
            style={[styles.button, (!email.trim() || submitting) && styles.disabled]}
            onPress={handleSubmit}
            disabled={!email.trim() || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Send reset code</Text>
            )}
          </Pressable>
        </>
      )}

      <View style={styles.footerRow}>
        <Link href="/login" replace>
          <Text style={styles.footerLink}>Back to log in</Text>
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
    fontSize: 24,
    fontWeight: '800',
    color: '#1F6F50',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7A73',
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmationText: {
    fontSize: 14,
    color: '#173A2E',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
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
  footerLink: {
    color: '#1F6F50',
    fontWeight: '600',
    fontSize: 14,
  },
});
