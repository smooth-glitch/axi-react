import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { subscribeChanges } from '../core/api';

// Current window width (re-renders on resize).
export function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

// Width of an element (ResizeObserver): attach `ref` to it. Used for the form's column grid and the records table,
// so layout follows the space actually available (not the window).
export function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// "System" theme preference: dark overnight, light during the day, by the device's local clock -
// not the OS's prefers-color-scheme (which most people never touch). Re-checked every minute so an
// open tab flips automatically at the 06:00 / 18:00 thresholds without a reload.
const isNight = (d = new Date()) => d.getHours() < 6 || d.getHours() >= 18;

export function useAutoDark() {
  const [dark, setDark] = useState(isNight);
  useEffect(() => {
    const id = setInterval(() => setDark(isNight()), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return dark;
}

/**
 * useLiveChanges(handler): calls handler({ event, ...data }) for each server "something changed" push
 * (tstructs_changed / options_changed / submissions_changed) and for `resync` after a reconnect.
 * Bursts are coalesced (the latest handler runs once per ~150 ms) so a flurry of changes triggers one re-read.
 */
export function useLiveChanges(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let timer = null;
    let pending = [];
    const off = subscribeChanges((change) => {
      pending.push(change);
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = pending;
        pending = [];
        for (const c of batch) ref.current?.(c);
      }, 150);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
