import { Alert, Platform } from 'react-native';

/**
 * React Native's Alert.alert() silently does nothing on web (react-native-web
 * doesn't implement it). Use this everywhere instead of Alert.alert directly
 * so messages actually show up on web, not just iOS/Android.
 */
export function showAlert(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}
