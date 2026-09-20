import { registerSW } from 'virtual:pwa-register';

/** autoUpdate: the browser applies a freshly built service worker on next load. */
export const updateSW = registerSW({
  immediate: true,
  onOfflineReady() {
    // App shell is fully cached — safe to close the tab and come back offline.
    window.dispatchEvent(new CustomEvent('lgu-attendance:offline-ready'));
  },
  onNeedRefresh() {
    // Unused with registerType 'autoUpdate'; kept for future manifest changes.
  },
  onRegisteredSW(swUrl) {
    // no-op — dev-only console noise avoided on purpose
    void swUrl;
  },
});