import { ActionLink } from '../../src/components/ActionLink';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';

export default function ProfileScreen() {
  return (
    <PlaceholderScreen title="Mon profil" description="Les informations du compte et leur modification seront disponibles après l’intégration du profil. Aucune donnée personnelle n’est chargée.">
      <ActionLink href="/conversations" label="Mes conversations" />
      <ActionLink href="/" label="Consulter le catalogue" />
    </PlaceholderScreen>
  );
}
