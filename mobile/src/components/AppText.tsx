import { StyleSheet, Text, type TextProps } from 'react-native';
import { theme } from '../theme/theme';

type Props = TextProps & { variant?: 'title' | 'body' | 'muted' | 'label' };

export function AppText({ variant = 'body', style, ...props }: Props) {
  return (
    <Text
      accessibilityRole={variant === 'title' ? 'header' : undefined}
      {...props}
      style={[styles.base, styles[variant], style]}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: theme.colors.text, fontSize: 16, lineHeight: 25 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  body: {},
  muted: { color: theme.colors.muted },
  label: { fontWeight: '600' },
});
