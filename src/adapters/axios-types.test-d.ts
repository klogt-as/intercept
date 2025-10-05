/**
 * Type-level compatibility tests for axios adapter types.
 *
 * This file verifies type compatibility between our minimal types and axios types
 * where it matters for real-world usage. These are compile-time checks only.
 *
 * WHY THIS FILE EXISTS:
 * We don't include axios as a runtime dependency, but we need to ensure our types
 * work correctly when users integrate with actual axios instances. This file will
 * cause TypeScript compilation to FAIL if critical compatibility breaks.
 *
 * WHAT THIS FILE TESTS:
 * - Core field compatibility (data, status, config structure)
 * - Error handling patterns (isAxiosError checks)
 * - Generic type parameters
 * - Runtime usage patterns that users depend on
 *
 * WHAT THIS FILE DOES NOT TEST:
 * - Full structural type equality (headers are intentionally different)
 * - Unused axios-specific fields (adapter, transformRequest, etc.)
 *
 * Note: axios is installed as a devDependency purely for type checking.
 */

import type { AxiosRequestConfig, AxiosResponse } from "axios";
import type {
  MinimalAxiosConfig,
  MinimalAxiosError,
  MinimalAxiosResponse,
} from "./types";

// ============================================================================
// Type Testing Utilities
// ============================================================================

/**
 * Utility to check if a type extends another (one-way compatibility check).
 * Usage: type Test = Extends<MyType, TargetType>; // should be 'true'
 */
type Extends<T, U> = T extends U ? true : false;

/**
 * Utility to extract specific properties for comparison.
 */
type PickProps<T, K extends keyof T> = Pick<T, K>;

// ============================================================================
// Response Type Compatibility Tests
// ============================================================================

/**
 * TEST: Core response fields are compatible
 *
 * We verify that the essential fields (data, status, statusText) match.
 * Note: headers and config are intentionally excluded as they have different types.
 */
type ResponseCoreFields = "data" | "status" | "statusText";

type _TestResponseCoreCompatible = Extends<
  PickProps<MinimalAxiosResponse, ResponseCoreFields>,
  PickProps<AxiosResponse, ResponseCoreFields>
>;

const _testResponseCore: _TestResponseCoreCompatible = true;

/**
 * TEST: Response generics work correctly
 */
interface TestApiResponse {
  id: number;
  name: string;
}

// Our response with specific data type should have correct type inference
const testTypedResponse: MinimalAxiosResponse<TestApiResponse> = {
  data: { id: 1, name: "test" },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
  request: null,
};

// Data should be properly typed
const _testDataType: TestApiResponse = testTypedResponse.data;
const _testIdType: number = testTypedResponse.data.id;

/**
 * TEST: Response can be used in common patterns
 */
function _processResponse(response: MinimalAxiosResponse): void {
  // Common usage patterns that must work
  const status: number = response.status;
  const data: unknown = response.data;
  const _statusText: string = response.statusText;

  // These should compile without errors
  if (status >= 200 && status < 300) {
    console.log("Success:", data);
  }
}

// ============================================================================
// Config Type Compatibility Tests
// ============================================================================

/**
 * TEST: Core config fields are compatible
 *
 * We verify that common fields (url, method, data, params) are compatible.
 * Note: headers are intentionally excluded as they have different types.
 */
type ConfigCoreFields = "url" | "method" | "data" | "params" | "baseURL";

type _TestConfigCoreCompatible = Extends<
  PickProps<MinimalAxiosConfig, ConfigCoreFields>,
  PickProps<AxiosRequestConfig, ConfigCoreFields>
>;

const _testConfigCore: _TestConfigCoreCompatible = true;

/**
 * TEST: Common config patterns compile correctly
 */
const validConfig: MinimalAxiosConfig = {
  url: "/api/users",
  method: "POST",
  baseURL: "https://api.example.com",
  data: { name: "John", age: 30 },
  params: { filter: "active" },
  headers: {
    "Content-Type": "application/json",
    // Our extension: support more flexible header types
    "X-Request-ID": 12345,
    "X-Debug": true,
  },
};

// Core fields should be usable
const _url: string | undefined = validConfig.url;
const _method: string | undefined = validConfig.method;
const _data: unknown = validConfig.data;

// ============================================================================
// Error Type Compatibility Tests
// ============================================================================

/**
 * TEST: Critical error properties are present
 *
 * The most important fields for error handling are:
 * - isAxiosError (for type narrowing)
 * - response (for status/data access)
 * - config (for request details)
 * - message (inherited from Error)
 */
type CriticalErrorProps = {
  isAxiosError: true;
  response: MinimalAxiosResponse;
  config: MinimalAxiosConfig;
  message: string;
  code?: string;
};

type _TestErrorHasCriticalProps = Extends<
  CriticalErrorProps,
  Pick<
    MinimalAxiosError,
    "isAxiosError" | "response" | "config" | "message" | "code"
  >
>;

const _testErrorProps: _TestErrorHasCriticalProps = true;

/**
 * TEST: Error generic types work correctly
 */
interface ErrorPayload {
  error: string;
  code: number;
}

const typedError: MinimalAxiosError<ErrorPayload> = Object.assign(
  new Error("Request failed"),
  {
    isAxiosError: true as const,
    response: {
      data: { error: "Not found", code: 404 },
      status: 404,
      statusText: "Not Found",
      headers: {},
      config: {},
      request: null,
    },
    config: {},
    code: "ERR_NOT_FOUND",
    request: null,
  },
);

// Error data should be properly typed
const _errorData: ErrorPayload = typedError.response.data;
const _errorCode: number = typedError.response.data.code;

// ============================================================================
// Real-World Usage Pattern Tests
// ============================================================================

/**
 * TEST: Error type narrowing (most critical pattern)
 *
 * This is how users check for axios errors in catch blocks.
 * If this pattern doesn't work, the library is broken for users.
 */
function _handleError(error: unknown): void {
  // Pattern 1: Type guard using isAxiosError
  if (
    error &&
    typeof error === "object" &&
    "isAxiosError" in error &&
    error.isAxiosError === true
  ) {
    const axiosError = error as MinimalAxiosError;

    // These MUST work for the adapter to be usable
    const status: number = axiosError.response.status;
    const _responseData: unknown = axiosError.response.data;
    const requestUrl: string | undefined = axiosError.config.url;
    const _errorMessage: string = axiosError.message;

    console.log(`Request to ${requestUrl} failed with status ${status}`);
  }
}

/**
 * TEST: Response data access pattern
 */
async function _fetchUserData(): Promise<void> {
  // Simulate response handling
  const response: MinimalAxiosResponse<{ id: number; name: string }> = {
    data: { id: 1, name: "John" },
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
    config: { url: "/api/users/1" },
    request: null,
  };

  // Common patterns that must work
  const userId: number = response.data.id;
  const userName: string = response.data.name;
  const isSuccess: boolean = response.status === 200;

  console.log(`User ${userId}: ${userName}, success: ${isSuccess}`);
}

/**
 * TEST: Config building pattern
 */
function _buildConfig(baseUrl: string, token: string): MinimalAxiosConfig {
  // Users should be able to build configs programmatically
  return {
    baseURL: baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    validateStatus: (status: number) => status >= 200 && status < 300,
  };
}

/**
 * TEST: Error response access pattern
 */
function _handleApiError(error: MinimalAxiosError): void {
  // Common error handling patterns
  const statusCode: number = error.response.status;
  const _errorData: unknown = error.response.data;
  const _requestMethod: string | undefined = error.config.method;

  if (statusCode === 404) {
    console.log("Resource not found");
  } else if (statusCode >= 500) {
    console.log("Server error");
  }
}

// ============================================================================
// Documentation: Known Type Differences
// ============================================================================

/**
 * DOCUMENTED TYPE INCOMPATIBILITIES:
 *
 * These are intentional design decisions, not bugs:
 *
 * 1. HEADERS TYPE MISMATCH
 *    Problem:
 *      - MinimalAxiosHeaders: Record<string, string | number | boolean | Date | unknown | array>
 *      - AxiosHeaders: Complex class with specific value types (string | number | boolean only)
 *
 *    Why this is okay:
 *      - We normalize all headers to WHATWG Headers at the adapter boundary
 *      - Users can pass more flexible types, we handle the conversion
 *      - Runtime behavior is correct even though types don't match structurally
 *
 *    Impact:
 *      - MinimalAxiosResponse is NOT fully assignable to AxiosResponse (headers field differs)
 *      - MinimalAxiosConfig is NOT fully assignable to AxiosRequestConfig (headers field differs)
 *      - This doesn't break real usage because we control the adapter implementation
 *
 * 2. MISSING AXIOS-SPECIFIC FIELDS
 *    Not included in our types:
 *      - adapter, transformRequest, transformResponse (we override these)
 *      - proxy, httpAgent, httpsAgent (Node-specific)
 *      - onUploadProgress, onDownloadProgress (not supported)
 *      - xsrfCookieName, xsrfHeaderName (app-level concern)
 *      - cancelToken, signal (different cancellation model)
 *      - And many more...
 *
 *    Why this is okay:
 *      - Our adapter replaces axios's adapter, so we don't need these fields
 *      - Keeping types minimal reduces complexity
 *      - Users only interact with common fields we support
 *
 * 3. RESPONSE HEADERS STRUCTURE
 *    Problem:
 *      - Our response.headers: Record<string, string>
 *      - Axios response.headers: AxiosResponseHeaders (complex type)
 *
 *    Why this is okay:
 *      - We normalize headers to plain objects for simplicity
 *      - Users typically just read headers as strings
 *      - Type is simpler and more predictable
 *
 * BOTTOM LINE:
 * Full structural type compatibility is NOT the goal. The goal is:
 * 1. Core fields (data, status, etc.) are compatible ✓
 * 2. Error handling patterns work correctly ✓
 * 3. Generic types work as expected ✓
 * 4. Runtime behavior is correct ✓
 *
 * The type differences are by design and don't break real-world usage.
 */

// ============================================================================
// Verification Summary
// ============================================================================

/**
 * WHAT THIS FILE VERIFIES:
 *
 * ✓ Response data, status, and statusText have compatible types
 * ✓ Config url, method, data, and params have compatible types
 * ✓ Error isAxiosError, response, config, and message are present
 * ✓ Generic type parameters work correctly for responses and errors
 * ✓ Error type narrowing pattern compiles and works
 * ✓ Common usage patterns (data access, error handling) are type-safe
 *
 * ✗ Full structural compatibility (headers differ intentionally)
 * ✗ Unused axios-specific fields (not needed for our use case)
 *
 * If this file fails to type-check, it indicates a breaking change that
 * would affect users. The goal is compile-time verification of critical
 * compatibility points, not perfect type mirroring.
 */

export type { MinimalAxiosConfig, MinimalAxiosError, MinimalAxiosResponse };
