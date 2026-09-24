import { API_BASE_PATH } from '@rap/shared';

function read(name: keyof ImportMetaEnv, fallback = ''): string {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value : fallback;
}

const apiUrl = read('VITE_API_URL', 'http://localhost:3000').replace(/\/+$/, '');

export const env = {
  apiUrl,
  apiBaseUrl: `${apiUrl}${API_BASE_PATH}`,
  publicUrl: read('VITE_PUBLIC_URL') || (typeof window !== 'undefined' ? window.location.origin : ''),
  uploadInternalOrigin: read('VITE_UPLOAD_INTERNAL_ORIGIN', import.meta.env.DEV ? 'http://minio:9000' : ''),
  uploadProxyPath: read('VITE_UPLOAD_PROXY_PATH', '/__media-upload'),
  isDev: import.meta.env.DEV,
} as const;
