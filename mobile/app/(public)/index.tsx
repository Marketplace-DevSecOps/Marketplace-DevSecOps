import { ActionLink } from '../../src/components/ActionLink';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';

export default function CatalogueScreen() {
  return (
    <PlaceholderScreen title="Catalogue" description="Les annonces, la recherche et les filtres seront disponibles après le raccordement du catalogue. Aucune annonce n’est chargée à cette étape.">
      <ActionLink href="/login" label="Se connecter" />
      <ActionLink href="/register" label="Créer un compte" />
      <ActionLink href="/profile" label="Mon profil" hint="Une connexion est requise." />
      <ActionLink href="/conversations" label="Mes conversations" hint="Une connexion est requise." />
    </PlaceholderScreen>
  );
}
