import { INTERCEPT_LOG_PREFIX } from "./constants";
import type { ListenOptions } from "./types";

/**
 * Utility type: makes all properties required, converts their type to `T | null`.
 */
type ToConfig<T> = {
  [K in keyof T]-?: Exclude<T[K], undefined> | null;
};

/** Helper type: same shape as ToConfig<T> but with null removed from each field. */
type NonNullConfig<T> = {
  [K in keyof ToConfig<T>]: Exclude<ToConfig<T>[K], null>;
};

/**
 * Initial values for the global store.
 * Note: `null` = "not configured yet".
 */
const initial = {
  configs: {
    onUnhandledRequest: "warn" as ToConfig<ListenOptions>["onUnhandledRequest"],
  },
  listening: false,
  origin: null as string | null,
  originalFetch: null as typeof globalThis.fetch | null,
  fetchAdapterAttached: false,
};

// Unique global symbol so this works even if the package is installed twice
const STORE_KEY = Symbol.for("@klogt/intercept.store");

/** Centralized shape of the global store. */
type Store = {
  configs: ToConfig<ListenOptions>;
  listening: boolean;
  origin: string | null;
  originalFetch: typeof globalThis.fetch | null;
  fetchAdapterAttached: boolean;
};

// Create or retrieve the shared store from globalThis.
const g = globalThis as Record<PropertyKey, unknown>;
const store: Store =
  (g[STORE_KEY] as Store) ??
  ({
    configs: { ...initial.configs },
    listening: initial.listening,
    origin: initial.origin,
    originalFetch: initial.originalFetch,
    fetchAdapterAttached: initial.fetchAdapterAttached,
  } as Store);

g[STORE_KEY] = store;

/* ---------------------------------------------
 * Configs (onUnhandledRequest)
 * --------------------------------------------*/
export function getConfigs(): Readonly<NonNullConfig<ListenOptions>> {
  const configs = store.configs;

  for (const key of Object.keys(configs) as (keyof typeof configs)[]) {
    if (configs[key] === null) {
      throw new Error(
        `${INTERCEPT_LOG_PREFIX} Config "${String(
          key,
        )}" is not initialized. Call intercept.listen({ ... }) first.`,
      );
    }
  }
  return configs as Readonly<NonNullConfig<ListenOptions>>;
}

export function setConfigs(next: Partial<ToConfig<ListenOptions>>) {
  store.configs = {
    ...store.configs,
    onUnhandledRequest:
      next.onUnhandledRequest ?? store.configs.onUnhandledRequest ?? null,
  };
}

export function resetConfigs() {
  store.configs = { ...initial.configs };
}

/* ---------------------------------------------
 * Listening flag (single source of truth)
 * --------------------------------------------*/
export function isListening(): boolean {
  return store.listening;
}

export function setListening(value: boolean) {
  store.listening = value;
}

/* ---------------------------------------------
 * Origin (shared across module instances)
 * --------------------------------------------*/
export function getOrigin(): string | null {
  return store.origin;
}

export function setOrigin(next: string | null) {
  store.origin = next;
}

/* ---------------------------------------------
 * Fetch patching flags (to restore correctly)
 * --------------------------------------------*/
export function getOriginalFetch(): typeof globalThis.fetch | null {
  return store.originalFetch;
}

export function setOriginalFetch(fn: typeof globalThis.fetch | null) {
  store.originalFetch = fn;
}

export function isFetchAdapterAttached(): boolean {
  return store.fetchAdapterAttached;
}

export function setFetchAdapterAttached(value: boolean) {
  store.fetchAdapterAttached = value;
}
