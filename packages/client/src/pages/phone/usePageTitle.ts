import { useEffect, useState } from 'react';
import { FLASH_SECONDS, pageTitle, type CalledAlert, type NextAlert } from './alerts.ts';

/**
 * Sets the tab's title from the alerts, and puts the old one back when the page goes. While a
 * call is up the title flips between the call and the page's name every second, so it shows on
 * a tab that isn't in front.
 */
export function usePageTitle(called: readonly CalledAlert[], next: readonly NextAlert[], base: string): void {
  const [flip, setFlip] = useState(false);
  const calling = called.length > 0;

  useEffect(() => {
    if (!calling) return;
    const timer = setInterval(() => setFlip((current) => !current), FLASH_SECONDS * 1000);
    return () => {
      clearInterval(timer);
      setFlip(false);
    };
  }, [calling]);

  // First, so it reads the title the page had before this hook changed it.
  useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);

  const title = pageTitle({ called, next, flip, base });
  useEffect(() => {
    document.title = title;
  }, [title]);
}
