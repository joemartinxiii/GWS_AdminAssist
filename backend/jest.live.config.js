const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/tests/live/**/*.live.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  setupFilesAfterEnv: ['<rootDir>/tests/live/setup.ts'],
  testTimeout: 180000,
};
