import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'diffspoiler',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*', 'https://gitlab.com/*'],
  },
});
