import { forwardRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { theme } from '../theme/theme';
import { AppText } from './AppText';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary';
};

export const ActionButton = forwardRef<ComponentRef<typeof Pressable>, Props>(function ActionButton(
  { label, variant = 'primary', disabled, accessibilityState, ...props }, ref,
) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...props}
      disabled={disabled}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.base, styles[variant], (pressed || disabled) && styles.dimmed,
      ]}
    >
      <AppText variant="label" style={variant === 'primary' ? styles.primaryText : styles.secondaryText}>
        {label}
      </AppText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    minHeight: 48, paddingVertical: 12, paddingHorizontal: theme.space.md,
    borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  primary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  secondary: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
  primaryText: { color: theme.colors.onPrimary, textAlign: 'center' },
  secondaryText: { color: theme.colors.primary, textAlign: 'center' },
  dimmed: { opacity: 0.65 },
});
