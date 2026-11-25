import { ActionLink } from '../../src/components/ActionLink';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';

export default function LoginScreen() {
  return (
    <PlaceholderScreen title="Connexion" description="La connexion sera disponible après l’intégration du service de session. Aucune information de connexion n’est demandée pour le moment.">
      <ActionLink href="/register" label="Créer un compte" />
      <ActionLink href="/" label="Consulter le catalogue" />
    </PlaceholderScreen>
  );
}
