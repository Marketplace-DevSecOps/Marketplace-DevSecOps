import { Stack } from 'expo-router';
import { stackOptions } from '../../src/theme/theme';

export default function AuthenticatedLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="profile" options={{ title: 'Mon profil' }} />
      <Stack.Screen name="conversations/index" options={{ title: 'Mes conversations' }} />
      <Stack.Screen name="conversations/[id]" options={{ title: 'Conversation' }} />
    </Stack>
  );
}
