// --------- Minimal Axios typings (no `any`) ----------
/** biome-ignore-all lint/suspicious/noTsIgnore: <allow missing axios types> */
/** biome-ignore-all lint/suspicious/noExplicitAny: <allow missing axios types> */

export type MinimalAxiosHeaders = Record<string, string>;

export type MinimalAxiosConfig = {
  url?: string;
  baseURL?: string;
  method?: string;
  headers?: MinimalAxiosHeaders;
  data?: unknown;
};

export type MinimalAxiosResponse<T = unknown> = {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: MinimalAxiosConfig;
  request: unknown;
};

export type AxiosAdapterFn = (
  config: MinimalAxiosConfig
) => Promise<MinimalAxiosResponse>;

export type MinimalAxiosInstance = {
  defaults: {
    adapter?: AxiosAdapterFn | undefined;
    baseURL?: string | undefined;
  };
  request: (config: MinimalAxiosConfig) => Promise<MinimalAxiosResponse>;
};

export type MinimalAxiosError<T = unknown> = Error & {
  isAxiosError: true;
  response: MinimalAxiosResponse<T>;
  config: MinimalAxiosConfig;
};

// --------- Compatibility layer for real axios (type-only) ----------

/**
 * A loose adapter function type so we can store either a real axios adapter
 * or our stub adapter without importing axios at runtime.
 */
export type AnyAxiosAdapter = (config: any) => Promise<any>;

/**
 * A structural instance type that both a real AxiosInstance and our stub match.
 * We only read/write `defaults.adapter` and read `defaults.baseURL`.
 */
export interface CompatibleAxiosInstance {
  defaults: {
    adapter?: AnyAxiosAdapter | null;
    baseURL?: string;
  };
}

/**
 * Union that accepts either our compatible shape or a real axios instance,
 * without creating a runtime dependency on axios. The conditional `import()`
 * is erased at compile-time if axios types are not present.
 */
export type AxiosLikeInstance =
  | CompatibleAxiosInstance
  // @ts-ignore: allow missing axios types
  | import("axios").AxiosInstance;
