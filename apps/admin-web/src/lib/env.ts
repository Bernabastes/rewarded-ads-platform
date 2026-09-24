import { API_BASE_PATH } from '@rap/shared';

const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || 'http://localhost:3000';

export const env = {
  /** Origin of the API server (no path). */
  apiOrigin: rawApiUrl.replace(/\/+$/, ''),
  /** Fully-qualified versioned base URL, e.g. http://localhost:3000/api/v1 */
  apiBaseUrl: `${rawApiUrl.replace(/\/+$/, '')}${API_BASE_PATH}`,
  isDev: import.meta.env.DEV,
  mode: import.meta.env.MODE,
} as const;
