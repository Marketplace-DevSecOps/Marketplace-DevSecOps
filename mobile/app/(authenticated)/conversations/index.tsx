import { ActionLink } from '../../../src/components/ActionLink';
import { PlaceholderScreen } from '../../../src/components/PlaceholderScreen';

export default function ConversationsScreen() {
  return (
    <PlaceholderScreen title="Mes conversations" description="La liste des conversations sera raccordée à la messagerie. Aucune conversation n’est chargée et aucune connexion temps réel n’est ouverte.">
      <ActionLink href="/" label="Consulter le catalogue" />
    </PlaceholderScreen>
  );
}
