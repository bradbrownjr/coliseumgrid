import { useCallback, useEffect, useRef, useState } from 'react';
import { CALL_BEEPS } from './alerts.ts';

/**
 * The call sound, made with Web Audio so nothing is fetched. A page may not play sound before
 * the player touches it, and an `AudioContext` made earlier starts suspended
 * (https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay). So the context is made
 * on the first tap anywhere on the page, or on the "Tap to turn on sound" button, and `on`
 * says when it is running.
 */
export function useAlertSound() {
  const context = useRef<AudioContext | null>(null);
  const [on, setOn] = useState(false);

  const unlock = useCallback(() => {
    if (typeof AudioContext === 'undefined') return;
    const ctx = (context.current ??= new AudioContext());
    ctx.onstatechange = () => setOn(ctx.state === 'running');
    void ctx.resume().then(() => {
      setOn(ctx.state === 'running');
    });
  }, []);

  // The first touch anywhere turns the sound on, so most players never see the button.
  useEffect(() => {
    if (on) return;
    const events = ['pointerdown', 'keydown'] as const;
    for (const name of events) document.addEventListener(name, unlock, { once: true, passive: true });
    return () => {
      for (const name of events) document.removeEventListener(name, unlock);
    };
  }, [on, unlock]);

  useEffect(
    () => () => {
      void context.current?.close();
      context.current = null;
    },
    [],
  );

  /** Plays the call sound. Does nothing before the first tap. */
  const play = useCallback(() => {
    const ctx = context.current;
    if (!ctx || ctx.state !== 'running') return;
    const start = ctx.currentTime + 0.02;
    for (const beep of CALL_BEEPS) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = beep.hertz;
      // A quick fade at each end, so the beeps don't click.
      gain.gain.setValueAtTime(0, start + beep.at);
      gain.gain.linearRampToValueAtTime(0.25, start + beep.at + 0.02);
      gain.gain.setValueAtTime(0.25, start + beep.at + beep.length - 0.03);
      gain.gain.linearRampToValueAtTime(0, start + beep.at + beep.length);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start + beep.at);
      oscillator.stop(start + beep.at + beep.length);
    }
  }, []);

  return { on, unlock, play };
}
