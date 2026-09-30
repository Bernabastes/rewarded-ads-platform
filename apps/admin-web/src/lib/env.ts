import { API_BASE_PATH } from '@rap/shared';

const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
/**
 * Unset → the local API. Explicitly empty or "/" → same-origin (relative `/api/v1`), which is how the Vite dev
 * proxy is used when the dev server runs on a port outside the API's CORS allow-list.
 */
const rawApiUrl = raw === undefined ? 'http://localhost:3000' : raw.replace(/\/+$/, '');

export const env = {
  /** Origin of the API server (no path); empty string in same-origin mode. */
  apiOrigin: rawApiUrl,
  /** Versioned base URL, e.g. http://localhost:3000/api/v1 (or just /api/v1 in same-origin mode). */
  apiBaseUrl: `${rawApiUrl}${API_BASE_PATH}`,
  sameOrigin: rawApiUrl === '',
  isDev: import.meta.env.DEV,
  mode: import.meta.env.MODE,
} as const;
