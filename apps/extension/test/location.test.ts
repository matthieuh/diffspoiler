import { afterEach, describe, expect, it, vi } from 'vitest';
import { committedLocationChanges } from '../src/lib/location';

function setUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

describe('committedLocationChanges', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'navigation');
  });

  describe('with the Navigation API', () => {
    function withNavigation() {
      const navigation = new EventTarget();
      Object.defineProperty(window, 'navigation', { value: navigation, configurable: true });
      const wxt = vi.fn();
      const cb = vi.fn();
      const unsubscribe = committedLocationChanges(window, wxt)(cb);
      return { navigation, wxt, cb, unsubscribe };
    }

    it('reports the committed URL on currententrychange and ignores mere attempts', () => {
      const { navigation, wxt, cb } = withNavigation();
      setUrl('https://github.com/o/r/pull/1');

      // A download or stopped navigation: a navigate event, but the current entry never changes.
      navigation.dispatchEvent(new Event('navigate'));
      expect(cb).not.toHaveBeenCalled();

      setUrl('https://github.com/o/r/pull/2');
      navigation.dispatchEvent(new Event('currententrychange'));
      expect(cb).toHaveBeenCalledExactlyOnceWith('https://github.com/o/r/pull/2');
      expect(wxt).not.toHaveBeenCalled();
    });

    it('removes its listener on unsubscribe', () => {
      const { navigation, cb, unsubscribe } = withNavigation();

      unsubscribe();
      navigation.dispatchEvent(new Event('currententrychange'));

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("without the Navigation API (WXT's polling event)", () => {
    function withoutNavigation() {
      let fire = () => {};
      const cb = vi.fn();
      const unsubscribe = committedLocationChanges(window, (listener) => {
        fire = listener;
      })(cb);
      return { fire: () => fire(), cb, unsubscribe };
    }

    it('reports location.href one task after the event', async () => {
      const { fire, cb } = withoutNavigation();

      fire();
      setUrl('https://gitlab.com/g/p/-/merge_requests/3');
      expect(cb).not.toHaveBeenCalled();

      await vi.waitFor(() => expect(cb).toHaveBeenCalledExactlyOnceWith('https://gitlab.com/g/p/-/merge_requests/3'));
    });

    it('stops reporting after unsubscribe', async () => {
      const { fire, cb, unsubscribe } = withoutNavigation();

      fire();
      unsubscribe();
      await new Promise((r) => setTimeout(r, 10));

      expect(cb).not.toHaveBeenCalled();
    });
  });
});
