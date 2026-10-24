import { Alert, Platform } from 'react-native';

// Yes/no dialog that also works in a web browser (Alert.alert with buttons is a no-op on web).
export function confirm(title: string, message: string, okText: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okText, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

// Browsers can't put custom headers on a WebSocket, so the Drivado server (which needs
// X-WS-Key / X-Trip-ID / X-Device-ID) rejects every connection from the web build.
export const WEB_HEADERS_WARNING =
  'Web browser: WebSockets can’t send the X-WS-Key / X-Trip-ID / X-Device-ID headers, so the server rejects the connection. ' +
  'Use the APK or Expo Go on a phone to send data.';
