import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3108',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3108',
    url: 'http://127.0.0.1:3108',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-clipboard-test',
    },
  },
});
