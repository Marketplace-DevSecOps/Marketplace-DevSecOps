import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';

export const theme = {
  colors: {
    background: '#F3F6FA',
    surface: '#FFFFFF',
    text: '#14243B',
    muted: '#485B73',
    primary: '#174EA6',
    onPrimary: '#FFFFFF',
    accent: '#116354',
    accentSurface: '#E2F3ED',
    border: '#C6D2E0',
    danger: '#A22127',
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: 16,
} as const;

export const stackOptions = {
  headerStyle: { backgroundColor: theme.colors.surface },
  headerTintColor: theme.colors.primary,
  headerTitleStyle: { color: theme.colors.text },
  headerBackTitle: 'Retour',
  contentStyle: { backgroundColor: theme.colors.background },
} satisfies ComponentProps<typeof Stack>['screenOptions'];
