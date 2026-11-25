module.exports = {
  preset: 'jest-expo',
  cacheDirectory: '<rootDir>/.expo/jest-cache',
  testMatch: ['<rootDir>/src/tests/**/*.test.[jt]s?(x)'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  clearMocks: true,
  restoreMocks: true,
};
