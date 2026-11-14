// The push service worker (docs/PLAN.md, "Player view", "Push"). It shows a notification for
// each push and focuses or opens the player page when one is tapped. It has no `fetch`
// handler, so it can never answer a request or serve a stale copy of the app. Nothing here
// runs offline or over plain HTTP: the page registers it only when the server gave a push key.
//
// Built by vite.push-assets.ts into push-worker.js at the site root, so its scope covers
// /follow. It is checked with its own tsconfig (tsconfig.worker.json), which has the
// WebWorker types the page's DOM types can't share.

import { FOLLOW_PATH, NOTIFICATION_ICON, isFollowPage, notificationFor, parsePushAlert } from '../pages/phone/pushNotification.ts';

declare const self: ServiceWorkerGlobalScope;

/** `renotify` is in the Notifications standard but missing from TypeScript's worker types. */
type Options = NotificationOptions & { renotify: boolean };

self.addEventListener('push', (event) => {
  // Browsers require a visible notification for every push (userVisibleOnly), so a payload
  // that is missing or isn't JSON still gets the plain one.
  let data: unknown = null;
  try {
    data = event.data?.json();
  } catch {
    data = null;
  }
  const { title, body, tag } = notificationFor(parsePushAlert(data));
  // renotify: a newer alert for the same handle replaces the old one and still buzzes the phone.
  const options: Options = { tag, renotify: true, icon: NOTIFICATION_ICON, ...(body !== undefined && { body }) };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => isFollowPage(client.url, self.location.origin));
      if (open) return void (await open.focus());
      await self.clients.openWindow(FOLLOW_PATH);
    })(),
  );
});
