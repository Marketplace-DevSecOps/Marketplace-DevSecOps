import { StyleSheet, View } from 'react-native';
import { configuredServiceMode } from '../services/config';
import { AppText } from './AppText';

export function ServiceModeNotice() {
  if (configuredServiceMode() !== 'mock') return null;
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <AppText variant="label">MODE MOCK — DONNÉES FICTIVES</AppText>
      <AppText>Aucune opération n’est envoyée au serveur réel.</AppText>
    </View>
  );
}
const styles = StyleSheet.create({
  notice: { padding: 12, gap: 4, backgroundColor: '#FFF1CC', borderBottomWidth: 2, borderColor: '#8C6000' },
});
