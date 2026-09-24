import { useEffect, useRef } from 'react';

export interface HotkeyOptions {
  /** Fire even when focus is inside an input / textarea / contenteditable. */
  allowInInputs?: boolean;
  enabled?: boolean;
}

export type HotkeyHandler = (event: KeyboardEvent) => void;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox' ||
    target.closest('[cmdk-root]') !== null
  );
}

/**
 * Normalises a key event to a token like "mod+k", "shift+j", "j", "escape", "?".
 * `mod` is Cmd on macOS and Ctrl elsewhere.
 */
export function eventToToken(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && e.key.length > 1) parts.push('shift');
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

/** Register keyboard shortcuts. Map keys are tokens produced by `eventToToken`. */
export function useHotkeys(map: Record<string, HotkeyHandler>, options: HotkeyOptions = {}): void {
  const mapRef = useRef(map);
  mapRef.current = map;
  const { allowInInputs = false, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const token = eventToToken(e);
      const handler = mapRef.current[token];
      if (!handler) return;
      const modifier = token.startsWith('mod+');
      if (!allowInInputs && !modifier && isEditable(e.target)) return;
      handler(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [allowInInputs, enabled]);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl';
