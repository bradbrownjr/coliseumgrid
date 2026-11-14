import { useEffect, useState, type ReactNode } from 'react';
import { getPushKey } from '../../api/phone.ts';

/**
 * The VAPID public key when this server can send push (online, over HTTPS), or null: offline,
 * over plain HTTP, or when the call fails. Push is the one alert that needs the internet
 * (docs/PLAN.md, "Player view"), so the page offers it only when the server says it can.
 */
export function usePushKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getPushKey().then((result) => {
      if (!cancelled) setKey(result.ok ? result.data.publicKey : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return key;
}

interface PushSlotProps {
  publicKey: string | null;
  /** The subscribe control, given the key. */
  children?: (publicKey: string) => ReactNode;
}

/**
 * The one place "subscribe to push" goes on the player page. It shows only when the server
 * gave a key, so offline and over plain HTTP the page shows nothing and registers no service
 * worker.
 */
export function PushSlot({ publicKey, children }: PushSlotProps) {
  return publicKey === null || !children ? null : children(publicKey);
}
