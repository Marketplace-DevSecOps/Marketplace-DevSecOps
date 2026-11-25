import { Stack } from 'expo-router';
import { useSession } from '../features/auth/SessionProvider';
import { ErrorState, LoadingState } from '../components/AsyncState';
import { Screen } from '../components/Screen';
import { stackOptions } from '../theme/theme';

export function RootNavigator() {
  const { state, retry } = useSession();
  if (state.status === 'restoring') return <Screen fullScreen><LoadingState label="Préparation de la session…" /></Screen>;
  if (state.status === 'error') return (
    <Screen fullScreen><ErrorState title="Session indisponible" message="La session ne peut pas être vérifiée. Réessayez pour continuer." onRetry={retry} /></Screen>
  );

  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(public)" options={{ headerShown: false }} />
      <Stack.Protected guard={state.status === 'authenticated'} redirectTo="/login">
        <Stack.Screen name="(authenticated)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="+not-found" options={{ title: 'Page introuvable' }} />
    </Stack>
  );
}
