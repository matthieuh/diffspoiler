import { browser } from 'wxt/browser';

const TOKEN_KEY = 'github.token';

export async function getGitHubToken(): Promise<string | null> {
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  return typeof token === 'string' && token !== '' ? token : null;
}

export async function setGitHubToken(token: string | null): Promise<void> {
  if (token === null) {
    await browser.storage.local.remove(TOKEN_KEY);
    return;
  }
  await browser.storage.local.set({ [TOKEN_KEY]: token });
}
