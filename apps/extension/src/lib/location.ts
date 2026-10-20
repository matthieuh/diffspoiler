/**
 * Builds an `onLocationChange` that only reports committed URLs.
 *
 * WXT's `wxt:locationchange` fires on every navigation attempt (from the Navigation API's `navigate`
 * event), including downloads and stopped navigations that never change the page's URL.
 * `currententrychange` fires only once the new entry is current. `onWxtLocationChange` registers a
 * listener for WXT's event; it is used only where the Navigation API is missing (WXT polls there).
 */
export function committedLocationChanges(
  win: Window,
  onWxtLocationChange: (listener: () => void) => void,
): (cb: (url: string) => void) => () => void {
  return (cb) => {
    // lib.dom does not type the Navigation API yet.
    const navigation = (win as Window & { navigation?: EventTarget }).navigation;
    if (navigation && typeof navigation.addEventListener === 'function') {
      const listener = () => cb(win.location.href);
      navigation.addEventListener('currententrychange', listener);
      return () => navigation.removeEventListener('currententrychange', listener);
    }

    // WXT listeners only go away when the content-script context is invalidated, so gate the callback.
    let active = true;
    onWxtLocationChange(() => {
      win.setTimeout(() => {
        if (active) cb(win.location.href);
      }, 0);
    });
    return () => {
      active = false;
    };
  };
}
