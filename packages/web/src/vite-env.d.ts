/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set for the GitHub Pages build: ship and register the cross-origin-isolation worker. */
  readonly VITE_COI_SW?: string;
}
