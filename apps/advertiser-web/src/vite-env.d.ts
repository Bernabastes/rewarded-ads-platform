/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_PUBLIC_URL?: string;
  readonly VITE_UPLOAD_INTERNAL_ORIGIN?: string;
  readonly VITE_UPLOAD_PROXY_PATH?: string;
  readonly VITE_UPLOAD_PROXY_TARGET?: string;
}
