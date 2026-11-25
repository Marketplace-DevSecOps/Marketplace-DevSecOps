import { useLocalSearchParams } from 'expo-router';
import { ActionLink } from '../../../src/components/ActionLink';
import { PlaceholderScreen } from '../../../src/components/PlaceholderScreen';
import { ErrorState } from '../../../src/components/AsyncState';
import { Screen } from '../../../src/components/Screen';
import { isRouteId } from '../../../src/navigation/routeId';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  if (!isRouteId(id)) return (
    <Screen>
      <ErrorState title="Lien produit invalide" message="L’identifiant du produit n’est pas valide." />
      <ActionLink href="/" label="Revenir au catalogue" />
    </Screen>
  );
  return (
    <PlaceholderScreen title="Détail du produit" description="Le détail et le contact du vendeur seront raccordés au catalogue. La présence de cet écran ne confirme pas l’existence du produit.">
      <ActionLink href="/" label="Revenir au catalogue" />
    </PlaceholderScreen>
  );
}
