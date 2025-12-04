module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
  moduleNameMapper: {
    '^@matcha-ai/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@matcha-ai/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@matcha-ai/shared)/)',
  ],
};

