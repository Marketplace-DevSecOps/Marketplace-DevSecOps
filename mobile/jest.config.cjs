module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/tests/**/*.test.[jt]s?(x)'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  clearMocks: true,
  restoreMocks: true,
};
