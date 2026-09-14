/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  /** URL da API em produção (em dev o proxy do Vite cuida disso). */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
