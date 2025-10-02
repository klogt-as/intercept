import type {
  Adapter,
  ListenOptions,
  OnUnhandledRequestStrategy,
} from "./types";
import { getDefaultOnUnhandledRequest, validateOrigin } from "./utils";

/**
 * Configuration options that must be initialized before use.
 */
type StoreConfig = {
  onUnhandledRequest: OnUnhandledRequestStrategy;
};

/**
 * Global store state shared across all module instances.
 * Uses a Symbol key to ensure uniqueness even if package is installed multiple times.
 */
type Store = {
  /** Configuration options from listen() */
  config: StoreConfig;
  /** Whether the server is currently listening */
  listening: boolean;
  /** Current active origin (e.g., "https://api.example.com") */
  origin: string | null;
  /** Original fetch function before patching */
  originalFetch: typeof globalThis.fetch | null;
  /** Whether the fetch adapter has been attached */
  fetchAdapterAttached: boolean;
  /** Custom adapters that have been attached (beyond fetch) */
  customAdapters: Adapter[];
};

// Unique global symbol for cross-instance compatibility
const STORE_KEY = Symbol.for("@klogt/intercept.store");

// Initial state
const initialState: Store = {
  config: {
    onUnhandledRequest: getDefaultOnUnhandledRequest(),
  },
  listening: false,
  origin: null,
  originalFetch: null,
  fetchAdapterAttached: false,
  customAdapters: [],
};

// Create or retrieve the shared store from globalThis
const global = globalThis as Record<PropertyKey, unknown>;
const store: Store = (global[STORE_KEY] as Store) ?? { ...initialState };
global[STORE_KEY] = store;

/* ---------------------------------------------
 * Configuration
 * --------------------------------------------*/

/**
 * Get the current configuration.
 * Returns the config even if not fully initialized (for adapter use).
 */
export function getConfig(): Readonly<StoreConfig> {
  return store.config;
}

/**
 * Update configuration options.
 */
export function setConfig(options: Partial<ListenOptions>): void {
  store.config.onUnhandledRequest =
    options.onUnhandledRequest ?? store.config.onUnhandledRequest;
}

/**
 * Reset configuration to initial state.
 */
export function resetConfig(): void {
  store.config = { ...initialState.config };
}

/* ---------------------------------------------
 * Listening State
 * --------------------------------------------*/

/**
 * Check if the server is currently listening.
 */
export function isListening(): boolean {
  return store.listening;
}

/**
 * Set the listening state.
 */
export function setListening(value: boolean): void {
  store.listening = value;
}

/* ---------------------------------------------
 * Origin Management
 * --------------------------------------------*/

/**
 * Get the current active origin.
 * Returns null if no origin has been set.
 */
export function getOrigin(): string | null {
  return store.origin;
}

/**
 * Set the active origin with validation.
 * The origin must include protocol and host, without path/query/hash.
 *
 * @example
 * setOrigin("https://api.example.com") // ✅ Valid
 * setOrigin("https://api.example.com/") // ❌ Throws (trailing slash)
 * setOrigin("https://api.example.com/path") // ❌ Throws (has path)
 */
export function setOrigin(input: string): void {
  store.origin = validateOrigin(input);
}

/**
 * Clear the active origin.
 */
export function resetOrigin(): void {
  store.origin = null;
}

/* ---------------------------------------------
 * Fetch Adapter State
 * --------------------------------------------*/

/**
 * Get the original fetch function before patching.
 */
export function getOriginalFetch(): typeof globalThis.fetch | null {
  return store.originalFetch;
}

/**
 * Store the original fetch function.
 */
export function setOriginalFetch(fn: typeof globalThis.fetch | null): void {
  store.originalFetch = fn;
}

/**
 * Check if the fetch adapter is currently attached.
 */
export function isFetchAdapterAttached(): boolean {
  return store.fetchAdapterAttached;
}

/**
 * Set the fetch adapter attachment state.
 */
export function setFetchAdapterAttached(value: boolean): void {
  store.fetchAdapterAttached = value;
}

/* ---------------------------------------------
 * Custom Adapters Management
 * --------------------------------------------*/

/**
 * Get the list of custom adapters (non-fetch adapters).
 */
// export function getCustomAdapters(): Adapter[] {
//   return store.customAdapters;
// }

/**
 * Add a custom adapter to the store.
 */
export function addCustomAdapter(adapter: Adapter): void {
  store.customAdapters.push(adapter);
}

/**
 * Clear all custom adapters from the store.
 */
export function clearCustomAdapters(): void {
  store.customAdapters.length = 0;
}
