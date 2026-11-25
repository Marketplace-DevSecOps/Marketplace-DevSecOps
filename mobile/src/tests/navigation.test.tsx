import { renderRouter, screen, testRouter } from 'expo-router/testing-library';
import { userEvent } from '@testing-library/react-native';
import { sessionService } from '../services/session';

it.each(['/profile', '/conversations', '/conversations/00000000-0000-4000-8000-000000000001'])(
  'redirects the anonymous visitor away from %s',
  async (initialUrl) => {
    await renderRouter('./app', { initialUrl });
    expect(screen).toHavePathname('/login');
    expect(screen.getByText('Écran provisoire')).toBeVisible();
    expect(screen.queryByRole('header', { name: 'Conversation' })).toBeNull();
  },
);

it('keeps the public catalogue and registration reachable', async () => {
  await renderRouter('./app', { initialUrl: '/' });
  expect(screen.getByRole('header', { name: 'Catalogue' })).toBeVisible();
  await userEvent.setup().press(screen.getByRole('link', { name: 'Créer un compte' }));
  expect(screen).toHavePathname('/register');
  await testRouter.back();
  expect(screen).toHavePathname('/');
});

it('rejects a malformed product link without displaying it as a product', async () => {
  await renderRouter('./app', { initialUrl: '/products/invalid' });
  expect(screen.getByRole('alert', { name: 'Lien produit invalide' })).toBeVisible();
  await userEvent.setup().press(screen.getByRole('link', { name: 'Revenir au catalogue' }));
  expect(screen).toHavePathname('/');
});

it('renders the explicit fallback for an unknown destination', async () => {
  await renderRouter('./app', { initialUrl: '/unknown-destination' });
  expect(screen.getByRole('alert', { name: 'Page introuvable' })).toBeVisible();
});

it('opens private placeholders only with a validated-session double and rejects an invalid conversation link', async () => {
  jest.spyOn(sessionService, 'restore').mockResolvedValue({ userId: 'fixture-user' });
  await renderRouter('./app', { initialUrl: '/profile' });
  expect(screen).toHavePathname('/profile');
  expect(screen.getByText('Écran provisoire')).toBeVisible();
  await userEvent.setup().press(screen.getByRole('link', { name: 'Mes conversations' }));
  expect(screen).toHavePathname('/conversations');
  await testRouter.push('/conversations/invalid');
  expect(screen.getByRole('alert', { name: 'Lien de conversation invalide' })).toBeVisible();
});
