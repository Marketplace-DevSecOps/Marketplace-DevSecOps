import { useLocalSearchParams } from 'expo-router';
import { ActionLink } from '../../../src/components/ActionLink';
import { PlaceholderScreen } from '../../../src/components/PlaceholderScreen';
import { ErrorState } from '../../../src/components/AsyncState';
import { Screen } from '../../../src/components/Screen';
import { isRouteId } from '../../../src/navigation/routeId';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  if (!isRouteId(id)) return (
    <Screen>
      <ErrorState title="Lien de conversation invalide" message="L’identifiant de la conversation n’est pas valide." />
      <ActionLink href="/conversations" label="Revenir aux conversations" />
    </Screen>
  );
  return (
    <PlaceholderScreen title="Conversation" description="L’historique et l’envoi de messages seront intégrés ici. Aucun message n’est chargé ou envoyé à cette étape.">
      <ActionLink href="/conversations" label="Revenir aux conversations" />
    </PlaceholderScreen>
  );
}
