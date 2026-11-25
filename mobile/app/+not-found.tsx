import { ActionLink } from '../src/components/ActionLink';
import { ErrorState } from '../src/components/AsyncState';
import { Screen } from '../src/components/Screen';

export default function NotFoundScreen() {
  return (
    <Screen>
      <ErrorState title="Page introuvable" message="Cette destination n’est pas disponible." />
      <ActionLink href="/" label="Revenir au catalogue" />
    </Screen>
  );
}
