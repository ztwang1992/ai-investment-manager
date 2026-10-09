import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

// Pull to refresh: with the page scrolled to the top, pull down and release past 60px to refresh (as in the prototype).
// Touch uses native listeners (preventDefault is needed to stop the page bouncing); the mouse uses pointer events, for trying it on a computer.

const TRIGGER = 60;
const MAX_PULL = 90;
const RESISTANCE = 0.6;

export function usePullToRefresh(ref: RefObject<HTMLElement | null>, onRefresh: () => void): number {
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const startY = useRef<number | null>(null);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const atTop = () => ((el.closest('.app-main') as HTMLElement | null)?.scrollTop ?? 0) <= 0;
    const update = (value: number) => {
      pullRef.current = value;
      setPull(value);
    };
    const begin = (y: number, target: EventTarget | null) => {
      // Drags on the chart are left to the chart's horizontal scrubbing
      if (target instanceof Element && target.closest('[data-chart]')) return;
      if (atTop()) startY.current = y;
    };
    const move = (y: number, event: Event) => {
      if (startY.current === null) return;
      const next = Math.max(0, Math.min(MAX_PULL, (y - startY.current) * RESISTANCE));
      if (next > 0 && event.cancelable) event.preventDefault();
      if (Math.abs(next - pullRef.current) > 2 || next === 0) update(next);
    };
    const end = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (pullRef.current > TRIGGER) refresh.current();
      update(0);
    };

    const onTouchStart = (e: TouchEvent) => begin(e.touches[0]!.clientY, e.target);
    const onTouchMove = (e: TouchEvent) => move(e.touches[0]!.clientY, e);
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') begin(e.clientY, e.target);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') move(e.clientY, e);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointerleave', end);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointerleave', end);
    };
  }, [ref]);

  return pull;
}
