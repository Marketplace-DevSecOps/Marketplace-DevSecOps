import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { theme } from '../theme/theme';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';

export function RetryButton({ onRetry, label = 'Réessayer' }: { onRetry: () => void; label?: string }) {
  return <ActionButton label={label} onPress={onRetry} accessibilityHint="Relance uniquement cette opération." />;
}

export function LoadingState({ label = 'Chargement en cours…' }: { label?: string }) {
  return (
    <View style={styles.card} accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
      <ActivityIndicator color={theme.colors.primary} accessibilityLabel={label} />
      <AppText>{label}</AppText>
    </View>
  );
}

export function ErrorState({
  title = 'Une erreur est survenue', message, onRetry,
}: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <View style={styles.card}>
      <AppText variant="label" accessibilityRole="alert" style={styles.error}>{title}</AppText>
      <AppText>{message}</AppText>
      {onRetry ? <RetryButton onRetry={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.card}>
      <AppText variant="label">{title}</AppText>
      <AppText variant="muted">{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: theme.space.lg, gap: theme.space.md, borderRadius: theme.radius,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  error: { color: theme.colors.danger },
});
