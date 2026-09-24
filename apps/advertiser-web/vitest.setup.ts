import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './src/test/mocks/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

// jsdom lacks a few browser APIs used by Radix UI, Recharts and Framer Motion.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}
class IntersectionObserverMock {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: number[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    // Report everything as visible so in-view animations run immediately.
    this.callback(
      [{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
if (!('IntersectionObserver' in globalThis)) {
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
}
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!('PointerEvent' in window)) {
  vi.stubGlobal('PointerEvent', MouseEvent);
}
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.setPointerCapture ??= () => {};
