import { describe, expect, it } from 'vitest';
import { eventToToken } from './use-hotkeys';

const ev = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

describe('eventToToken', () => {
  it('lower-cases plain keys and keeps punctuation as-is', () => {
    expect(eventToToken(ev({ key: 'j' }))).toBe('j');
    expect(eventToToken(ev({ key: 'Escape' }))).toBe('escape');
    expect(eventToToken(ev({ key: '?', shiftKey: true }))).toBe('?');
  });

  it('distinguishes Shift+A from A (tick-all vs approve in the review queue)', () => {
    expect(eventToToken(ev({ key: 'A', shiftKey: true }))).toBe('shift+a');
    expect(eventToToken(ev({ key: 'a' }))).toBe('a');
    expect(eventToToken(ev({ key: 'ArrowDown', shiftKey: true }))).toBe('shift+arrowdown');
  });

  it('maps Ctrl / Cmd to "mod" and preserves shift with modifiers', () => {
    expect(eventToToken(ev({ key: 'k', ctrlKey: true }))).toBe('mod+k');
    expect(eventToToken(ev({ key: 'k', metaKey: true }))).toBe('mod+k');
    expect(eventToToken(ev({ key: 'L', ctrlKey: true, shiftKey: true }))).toBe('mod+shift+l');
    expect(eventToToken(ev({ key: 'x', altKey: true }))).toBe('alt+x');
  });
});
