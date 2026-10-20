import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getGitHubToken, setGitHubToken } from '../src/lib/settings';

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('returns null when no token is stored', async () => {
    expect(await getGitHubToken()).toBeNull();
  });

  it('round-trips the token under github.token', async () => {
    await setGitHubToken('ghp_x');
    expect(await getGitHubToken()).toBe('ghp_x');
    expect(await fakeBrowser.storage.local.get('github.token')).toEqual({ 'github.token': 'ghp_x' });
  });

  it('removes the key when set to null', async () => {
    await setGitHubToken('ghp_x');
    await setGitHubToken(null);
    expect(await fakeBrowser.storage.local.get('github.token')).toEqual({});
    expect(await getGitHubToken()).toBeNull();
  });
});
