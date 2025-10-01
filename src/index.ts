export { createAxiosAdapter } from "./adapters/axios";
export { createFetchAdapter } from "./adapters/fetch";

export type {
  MinimalAxiosConfig,
  MinimalAxiosInstance,
  MinimalAxiosResponse,
} from "./adapters/types";

export { createSetup, intercept } from "./api/intercept";

export type {
  ExtractPathParams,
  HttpMethod,
  JsonBodyType,
  JsonHeaders,
  ListenOptions,
  OnUnhandledRequestStrategy,
  Path,
} from "./core/types";

export { HttpResponse } from "./http/response";
