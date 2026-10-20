import { parsePrUrl } from '../lib/pr-ref';

export default defineContentScript({
  matches: ['https://github.com/*', 'https://gitlab.com/*'],
  runAt: 'document_idle',
  main() {
    parsePrUrl(location.href);
  },
});
