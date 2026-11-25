import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme/theme';

export function Screen({ children, fullScreen = false }: PropsWithChildren<{ fullScreen?: boolean }>) {
  return (
    <SafeAreaView style={styles.safe} edges={fullScreen ? undefined : ['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flexGrow: 1, padding: theme.space.lg },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: theme.space.lg },
});
