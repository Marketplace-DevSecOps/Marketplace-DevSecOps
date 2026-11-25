import { ActionLink } from '../../src/components/ActionLink';
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen';

export default function RegisterScreen() {
  return (
    <PlaceholderScreen title="Inscription" description="La création de compte sera raccordée au service d’inscription. Aucun compte n’est créé depuis cet écran provisoire.">
      <ActionLink href="/login" label="Aller à la connexion" />
      <ActionLink href="/" label="Consulter le catalogue" />
    </PlaceholderScreen>
  );
}
