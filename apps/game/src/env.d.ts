/// <reference types="vite/client" />

declare const __BUILD_VERSION__: string | undefined;

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_NAKAMA_HOST?: string;
  readonly VITE_NAKAMA_PORT?: string;
  readonly VITE_NAKAMA_SSL?: string;
  readonly VITE_NAKAMA_SERVER_KEY?: string;
  readonly VITE_ALLOW_LOCAL_FALLBACK?: string;
  readonly VITE_ENABLE_2V2?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
