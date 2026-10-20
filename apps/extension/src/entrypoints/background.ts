import { browser } from 'wxt/browser';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'open-options') {
      void browser.runtime.openOptionsPage();
    }
  });
});
