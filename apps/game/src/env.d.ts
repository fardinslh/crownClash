/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_NAKAMA_HOST?: string;
  readonly VITE_NAKAMA_PORT?: string;
  readonly VITE_NAKAMA_SSL?: string;
  readonly VITE_NAKAMA_SERVER_KEY?: string;
  readonly VITE_ALLOW_LOCAL_FALLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
