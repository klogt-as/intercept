// --------- Minimal Axios typings (no `any`) ----------

type MinimalAxiosHeaders = Record<string, string>;

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
    adapter?: AxiosAdapterFn;
  };
};

export type MinimalAxiosError<T = unknown> = Error & {
  isAxiosError: true;
  response: MinimalAxiosResponse<T>;
  config: MinimalAxiosConfig;
};
