import { act, render, screen, userEvent } from '@testing-library/react-native';
import { SessionProvider, useSession } from '../features/auth/SessionProvider';
import { RootNavigator } from '../navigation/RootNavigator';
import { AppText } from '../components/AppText';
import type { Session, SessionService } from '../services/session';

function SessionProbe() {
  const { state } = useSession();
  return <AppText>{state.status}</AppText>;
}

it('does not render a private destination while session validation is pending', async () => {
  let complete!: (session: Session | null) => void;
  const pending = new Promise<Session | null>((resolve) => { complete = resolve; });
  await render(<SessionProvider service={{ restore: () => pending }}><RootNavigator /></SessionProvider>);
  expect(screen.getByText('Préparation de la session…')).toBeVisible();
  expect(screen.queryByText('Mon profil')).toBeNull();
  // Resolve after unmount: the obsolete callback must be ignored.
  await screen.unmount();
  await act(async () => { complete({ userId: 'fixture-user' }); });
});

it('shows a neutral error and retries only when requested', async () => {
  const restore = jest.fn().mockRejectedValue(new Error('internal fixture detail'));
  await render(<SessionProvider service={{ restore }}><RootNavigator /></SessionProvider>);
  expect(await screen.findByRole('alert', { name: 'Session indisponible' })).toBeVisible();
  expect(screen.queryByText('internal fixture detail')).toBeNull();
  expect(restore).toHaveBeenCalledTimes(1);
  await userEvent.setup().press(screen.getByRole('button', { name: 'Réessayer' }));
  expect(restore).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole('alert', { name: 'Session indisponible' })).toBeVisible();
});

it('ignores a stale restoration when the service is replaced', async () => {
  let complete!: (session: Session | null) => void;
  const first: SessionService = { restore: () => new Promise((resolve) => { complete = resolve; }) };
  const next: SessionService = { restore: async () => null };
  const view = await render(<SessionProvider service={first}><SessionProbe /></SessionProvider>);
  await view.rerender(<SessionProvider service={next}><SessionProbe /></SessionProvider>);
  expect(await screen.findByText('anonymous')).toBeVisible();
  await act(async () => { complete({ userId: 'obsolete-fixture-user' }); });
  expect(screen.getByText('anonymous')).toBeVisible();
});
