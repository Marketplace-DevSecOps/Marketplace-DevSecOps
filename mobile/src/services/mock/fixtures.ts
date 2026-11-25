import type { CategoryDto, ConversationDto, CurrentUserDto, ProductDto } from '../../schemas/api';

export const MOCK_PASSWORD = 'Mock-passphrase-2026!';
export const MOCK_USER: CurrentUserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'acheteur@example.invalid', displayName: 'Acheteur fictif',
};
export const MOCK_CATEGORY: CategoryDto = {
  id: '44444444-4444-4444-8444-444444444444', label: 'Informatique fictive',
};
export const MOCK_PRODUCTS: ProductDto[] = [
  {
    id: '33333333-3333-4333-8333-333333333333', title: 'Clavier fictif',
    description: 'Annonce de démonstration, sans vendeur réel.', price: '250.00', currency: 'MAD',
    categoryId: MOCK_CATEGORY.id,
    seller: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Vendeur fictif' },
    createdAt: '2026-11-25T10:00:00.000Z', updatedAt: '2026-11-25T10:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333334', title: 'Souris fictive',
    description: 'Deuxième annonce fictive pour la pagination.', price: '125.50', currency: 'MAD',
    categoryId: MOCK_CATEGORY.id,
    seller: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Vendeur fictif' },
    createdAt: '2026-11-25T11:00:00.000Z', updatedAt: '2026-11-25T11:00:00.000Z',
  },
];
export const MOCK_CONVERSATION: ConversationDto = {
  id: '55555555-5555-4555-8555-555555555555', productId: MOCK_PRODUCTS[0]!.id,
  buyer: { id: MOCK_USER.id, displayName: MOCK_USER.displayName },
  seller: { ...MOCK_PRODUCTS[0]!.seller }, lastMessageSeq: 0, lastMessage: null,
  createdAt: '2026-11-25T12:00:00.000Z', updatedAt: '2026-11-25T12:00:00.000Z',
};
