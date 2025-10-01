// store.ts
import { INTERCEPT_LOG_PREFIX } from "./constants";
import type { ListenOptions } from "./types";

/**
 * Utility type that makes all properties required
 * and converts their type to `T | null` (never undefined).
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
const initial: { configs: ToConfig<ListenOptions> } = {
  configs: {
    onUnhandledRequest: "warn",
  },
};

// Unique global symbol so this works even if the package is installed twice.
const STORE_KEY = Symbol.for("@klogt/intercept.store");

/** Centralized shape of the global store. */
type Store = { configs: ToConfig<ListenOptions> };

// Create or retrieve the shared store from globalThis.
const g = globalThis as Record<PropertyKey, unknown>;
const store: Store = (g[STORE_KEY] as Store) ?? {
  configs: { ...initial.configs },
};
g[STORE_KEY] = store;

/**
 * Read configs and assert that all fields are initialized (non-null).
 * Throws if any field is still null.
 */
export function getConfigs(): Readonly<NonNullConfig<ListenOptions>> {
  const configs = store.configs;

  for (const key of Object.keys(configs) as (keyof typeof configs)[]) {
    if (configs[key] === null) {
      throw new Error(
        `${INTERCEPT_LOG_PREFIX} Config "${String(
          key,
        )}" is not initialized. Call server.listen({ ... }) first.`,
      );
    }
  }

  // At this point all fields are non-null; cast to the corresponding non-null type.
  return configs as Readonly<NonNullConfig<ListenOptions>>;
}

/**
 * Merge next values into the current configs.
 * Accepts partial ToConfig<ListenOptions>, keeps nulls as "not configured".
 */
export function setConfigs(next: Partial<ToConfig<ListenOptions>>) {
  store.configs = {
    ...store.configs,
    onUnhandledRequest:
      next.onUnhandledRequest ?? store.configs.onUnhandledRequest ?? null,
  };
}

/** Reset configs back to defaults. */
export function resetConfigs() {
  store.configs = { ...initial.configs };
}
