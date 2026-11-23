import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' }, serviceWorkers: 'block' },
  webServer: { command: 'mkdir -p tests/.fixture_site && python3 -m http.server 4173 --bind 127.0.0.1 -d tests/.fixture_site', url: 'http://127.0.0.1:4173/', reuseExistingServer: true, timeout: 30_000 },
  reporter: [['list'], ['json', { outputFile: 'tests/.e2e-result.json' }]],
});
