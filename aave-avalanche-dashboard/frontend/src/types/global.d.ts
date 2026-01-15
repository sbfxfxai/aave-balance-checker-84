// Extend the global Number interface to include isSafeInteger
declare global {
  interface NumberConstructor {
    isSafeInteger(number: unknown): boolean;
  }

  interface Window {
    __TILTVAULT_MAIN_LOADED__?: boolean;
  }
}

export {}; // This file needs to be a module
