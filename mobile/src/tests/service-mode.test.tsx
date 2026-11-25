import { render, screen } from '@testing-library/react-native';
import * as configuration from '../services/config';
import { ServiceModeNotice } from '../components/ServiceModeNotice';

it('visibly identifies fictional data when mock services are selected', async () => {
  jest.spyOn(configuration, 'configuredServiceMode').mockReturnValue('mock');
  await render(<ServiceModeNotice />);
  expect(screen.getByText('MODE MOCK — DONNÉES FICTIVES')).toBeVisible();
  expect(screen.getByText('Aucune opération n’est envoyée au serveur réel.')).toBeVisible();
});

it('does not describe real services as simulated', async () => {
  jest.spyOn(configuration, 'configuredServiceMode').mockReturnValue('real');
  await render(<ServiceModeNotice />);
  expect(screen.queryByText('MODE MOCK — DONNÉES FICTIVES')).toBeNull();
});
