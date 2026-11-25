import { Stack } from 'expo-router';
import { stackOptions } from '../../src/theme/theme';

export default function PublicLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="index" options={{ title: 'Secure Marketplace' }} />
      <Stack.Screen name="login" options={{ title: 'Connexion' }} />
      <Stack.Screen name="register" options={{ title: 'Inscription' }} />
      <Stack.Screen name="products/[id]" options={{ title: 'Détail du produit' }} />
    </Stack>
  );
}
