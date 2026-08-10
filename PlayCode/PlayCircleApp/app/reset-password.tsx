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

export default function ResetPasswordScreen() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = token.trim().length > 0 && newPassword.length >= 8;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', {
        token: token.trim(),
        new_password: newPassword,
      });
      showAlert('Password reset', 'You can now log in with your new password.');
      router.replace('/login');
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Something went wrong';
      showAlert('Could not reset password', message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter your reset code</Text>
      <Text style={styles.subtitle}>
        Paste the reset code you were given, then choose a new password.
      </Text>

      <TextInput
        placeholderTextColor="#9AA69E"
        style={styles.input}
        placeholder="Reset code"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
      />
      <TextInput
        placeholderTextColor="#9AA69E"
        style={styles.input}
        placeholder="New password (min 8 characters)"
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        onSubmitEditing={handleSubmit}
      />

      <Pressable
        style={[styles.button, (!canSubmit || submitting) && styles.disabled]}
        onPress={handleSubmit}
        disabled={!canSubmit || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Reset password</Text>
        )}
      </Pressable>

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
