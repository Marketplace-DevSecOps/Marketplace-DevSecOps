import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../theme/theme';
import { AppText } from './AppText';
import { Screen } from './Screen';
import { EmptyState } from './AsyncState';

export function PlaceholderScreen({ title, description, children }: PropsWithChildren<{
  title: string; description: string;
}>) {
  return (
    <Screen>
      <View style={styles.badge}><AppText style={styles.badgeText}>Écran provisoire</AppText></View>
      <AppText variant="title">{title}</AppText>
      <EmptyState title="Fonctionnalité à venir" message={description} />
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', backgroundColor: theme.colors.accentSurface, borderRadius: 8, padding: 8 },
  badgeText: { color: theme.colors.accent, fontWeight: '600' },
});
