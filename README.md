# @klogt/intercept

Small but powerful — MSW-flavored HTTP interception for tests, built for **Node 20+** with native `fetch`.  
Write routes inline, return typed JSON, and plug in clients like Axios — all while keeping tests fast, reliable, and free of mocks.

✅ Declare routes directly in your tests  
✅ Get typed JSON responses with the right status codes  
✅ Intercept both `fetch` and your favorite clients (Axios, etc.)  
✅ Reset state between tests for rock-solid isolation  

Built for **modern frontend testing** — fast, deterministic, and frustration-free.  
Perfect companion for **Vitest/Jest + React Testing Library**.

---

## Why

Modern frontend apps talk to APIs. In tests, you want predictable responses without spinning up servers or sprinkling mocks everywhere. `@klogt/intercept` sits in front of `fetch` (and optionally other clients) so you can:

- Declare routes alongside your tests
- Return JSON with correct status codes (204 → no body) and headers
- Decide what happens to **unhandled requests** (`"warn" | "bypass" | "error"`)
- Reset handlers between tests for clean isolation
- Optionally attach an **Axios adapter** — without a runtime dependency on Axios

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start (Vitest)](#quick-start-vitest)
  - [Required setup](#required-setup)
  - [Your first test](#your-first-test)
- [Understanding Origins](#understanding-origins)
  - [Relative paths require an origin](#relative-paths-require-an-origin)
  - [Absolute URLs ignore origin](#absolute-urls-ignore-origin)
  - [When to use which approach](#when-to-use-which-approach)
  - [Scoping origin per test file](#scoping-origin-per-test-file)
- [Using with React + TanStack Query](#using-with-react--tanstack-query)
  - [Test with intercept](#test-with-intercept)
- [Defining routes](#defining-routes)
  - [Basic responses](#basic-responses)
  - [Error responses](#error-responses)
  - [Path parameters](#path-parameters)
  - [Simulate fetching / pending state](#simulate-fetching--pending-state)
  - [Dynamic resolvers with `.handle()`](#dynamic-resolvers-with-handle)
- [Ignoring requests](#ignoring-requests)
- [Unhandled requests](#unhandled-requests)
  - [Strategies](#strategies)
- [Axios adapter (optional)](#axios-adapter-optional)
- [Common Testing Patterns](#common-testing-patterns)
  - [Pattern 1: Baseline routes in setup, overrides in tests](#pattern-1-baseline-routes-in-setup-overrides-in-tests)
  - [Pattern 2: Per-test origin for multi-tenant apps](#pattern-2-per-test-origin-for-multi-tenant-apps)
  - [Pattern 3: Test error scenarios](#pattern-3-test-error-scenarios)
  - [Pattern 4: Testing authentication flows](#pattern-4-testing-authentication-flows)
  - [Pattern 5: Ignoring non-essential requests](#pattern-5-ignoring-non-essential-requests)
- [API reference](#api-reference)
  - [`intercept.listen(options)`](#interceptlistenoptions)
  - [`intercept.origin(url)`](#interceptoriginurl)
  - [`intercept.<method>(path)`](#interceptmethodpath)
  - [`intercept.ignore(paths)`](#interceptignorepaths)
  - [`intercept.reset()`](#interceptreset)
  - [`intercept.close()`](#interceptclose)
- [Troubleshooting](#troubleshooting)
  - ["No intercept handler matched this request"](#no-intercept-handler-matched-this-request)
  - ["Cannot find module 'axios' or its type declarations"](#cannot-find-module-axios-or-its-type-declarations)
  - [ESM/CJS issues](#esmcjs-issues)
  - [Tests are flaky or handlers leak between tests](#tests-are-flaky-or-handlers-leak-between-tests)
  - [Relative paths don't work](#relative-paths-dont-work)
- [Comparison with MSW](#comparison-with-msw)
- [Advanced Usage](#advanced-usage)
  - [Creating custom adapters](#creating-custom-adapters)
  - [Type-safe responses](#type-safe-responses)
  - [Conditional responses](#conditional-responses)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Zero server**: intercepts Node 20+ native `fetch` directly
- **Route DSL**: `intercept.get('/users').resolve([{ id: 1 }])`
- **Smart defaults**: e.g., `POST` → `201` by default, `DELETE` → `204`
- **Unhandled strategies**: warn, bypass, or error
- **Composable**: `intercept.reset()`, `intercept.close()`
- **Adapters**: attach Axios (or write your own) so the same routes cover both `fetch` and your client
- **TypeScript-first**: no `any` in public API; path params are inferred

---

## Requirements

- **Node 20+** (uses built-in `fetch`)
- Test runner: **Vitest** or **Jest**

---

## Installation

### npm
```bash
npm i -D @klogt/intercept
```
### pnpm
```bash
pnpm add -D @klogt/intercept
```
### yarn
```bash
yarn add -D @klogt/intercept
```

No need to install `axios` unless you plan to attach the Axios adapter.

---

## Quick start (Vitest)

### Required setup

`intercept` will **not work** until you start the server in your test environment.  
The recommended way is to create a shared setup file (e.g. `setupTests.ts`) using the `createSetup()` helper:

```ts
// setupTests.ts
import { createSetup } from "@klogt/intercept";

const setup = createSetup({
  origin: 'https://api.example.com',
  onUnhandledRequest: 'error'
});

beforeAll(setup.start);
afterEach(setup.reset);
afterAll(setup.close);
```

**Important**: Configure this file in your `vitest.config.ts`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./setupTests.ts'],
  },
});
```

**Note**: `onUnhandledRequest` defaults to `'error'` in test environments (Vitest/Jest) and `'warn'` otherwise, so you can omit it if the default works for you.

### Your first test

Create a test file, e.g. `tests/users.test.ts`:

```ts
import { intercept } from "@klogt/intercept";

it("fetches users from API", async () => {
  // Mock the API response
  intercept.get("/users").resolve([
    { id: 1, name: "Ada" },
    { id: 2, name: "Grace" }
  ]);

  // Your code calls fetch('/users') - it gets the mocked response
  const res = await fetch('/users');
  const users = await res.json();
  
  expect(users).toHaveLength(2);
  expect(users[0].name).toBe("Ada");
});
```

---

## Understanding Origins

### Relative paths require an origin

When you use **relative paths** like `/users`, intercept needs to know the base URL. You can set this in two ways:

**Option 1: In `listen()` (recommended)**
```ts
intercept.listen({ 
  origin: 'https://api.example.com',
  onUnhandledRequest: 'error'
});

intercept.get("/users").resolve([{ id: 1 }]);
// Matches: https://api.example.com/users
```

**Option 2: With `.origin()` method**
```ts
intercept
  .listen({ onUnhandledRequest: 'error' })
  .origin('https://api.example.com');

intercept.get("/users").resolve([{ id: 1 }]);
// Matches: https://api.example.com/users
```

Both approaches work, but setting it in `listen()` is cleaner for test setup files.

### Absolute URLs ignore origin

If you use **absolute URLs**, they match exactly and ignore the origin:

```ts
intercept
  .get("https://payments.stripe.com/v1/charges")
  .resolve({ id: "ch_123" });

// Matches exactly: https://payments.stripe.com/v1/charges
// Does NOT use the origin from .origin()
```

### When to use which approach

- **Relative paths**: Use when all your API calls go to the same base URL
  ```ts
  .origin('https://api.example.com')
  intercept.get("/users").resolve(...)    // → https://api.example.com/users
  intercept.post("/posts").resolve(...)   // → https://api.example.com/posts
  ```

- **Absolute URLs**: Use when you need to mock specific external services
  ```ts
  intercept.get("https://cdn.example.com/config.json").resolve(...)
  intercept.post("https://analytics.example.com/events").resolve(...)
  ```

- **Mix both**: You can use both approaches in the same test!

### Scoping origin per test file

Set origin in `beforeAll` to apply it to all tests in that file:

```ts
describe("User API", () => {
  beforeAll(() => {
    intercept.origin('https://api.example.com');
  });

  it("fetches users", async () => {
    intercept.get("/users").resolve([{ id: 1 }]);
    // ... test code
  });
});
```

Or per test in `beforeEach`:

```ts
describe("Multi-tenant tests", () => {
  beforeEach(() => {
    const tenant = getCurrentTenant();
    intercept.origin(`https://${tenant}.api.example.com`);
  });

  it("fetches tenant-specific data", async () => {
    intercept.get("/data").resolve({ tenant: "acme" });
    // ... test code
  });
});
```

---

## Using with React + TanStack Query

`@klogt/intercept` plays nicely with data fetching libraries like **TanStack Query**.

Here's a simple example component:

```tsx
// Users.tsx
import { useQuery } from "@tanstack/react-query";

export function Users() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await fetch("/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <ul>
      {data.map((u: { id: number; name: string }) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  );
}
```

### Test with intercept

```tsx
// Users.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Users } from "./Users";
import { intercept } from "@klogt/intercept";

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

it("renders users from mocked API", async () => {
  intercept.get("/users").resolve([
    { id: 1, name: "Ada" },
    { id: 2, name: "Grace" },
  ]);

  renderWithQuery(<Users />);

  expect(await screen.findByText("Ada")).toBeInTheDocument();
  expect(await screen.findByText("Grace")).toBeInTheDocument();
});

it("shows error state on API failure", async () => {
  intercept.get("/users").reject({
    status: 500,
    body: { message: "Server error" }
  });

  renderWithQuery(<Users />);

  expect(await screen.findByText(/Error:/)).toBeInTheDocument();
});
```

---

## Defining routes

### Basic responses

```ts
// GET /users → 200 with array
intercept.get("/users").resolve([{ id: 1, name: "Ada" }]);

// POST /users → 201 with body
intercept.post("/users").resolve({ id: 2, name: "Grace" });

// DELETE /users/2 → 204 (no content)
intercept.delete("/users/:id").resolve(null, { status: 204 });

// PUT with custom status and headers
intercept.put("/profile").resolve(
  { id: "me", updated: true },
  {
    status: 200,
    headers: { "x-request-id": "abc123" },
  }
);
```

### Error responses

```ts
// Reject with error status and body
intercept.post("/login").reject({
  status: 401,
  body: { code: "INVALID_CREDENTIALS", message: "Invalid username or password" }
});

// 404 Not Found
intercept.get("/users/:id").reject({
  status: 404,
  body: { error: "User not found" }
});

// 422 Validation Error
intercept.post("/users").reject({
  status: 422,
  body: {
    errors: [
      { field: "email", message: "Email is required" }
    ]
  }
});
```

### Path parameters

```ts
// Match dynamic segments with :param
intercept.get("/users/:id").resolve({ id: "123", name: "Ada" });

// Access params in dynamic resolver
intercept.get("/users/:id").handle(({ params }) => {
  return Response.json({
    id: params.id,
    name: `User ${params.id}`
  });
});

// Multiple params
intercept.get("/orgs/:orgId/repos/:repoId").handle(({ params }) => {
  return Response.json({
    org: params.orgId,
    repo: params.repoId
  });
});

// Catch-all wildcard
intercept.get("/*").resolve({ message: "Catch all requests" });
```

### Adding delays with `.delay()`

Need to simulate network latency? Use `.delay(ms)` for a cleaner syntax:

```ts
// Resolve after 500ms
intercept.get("/users").delay(500).resolve([{ id: 1, name: "Ada" }]);

// Reject after 1 second
intercept.post("/login").delay(1000).reject({
  status: 401,
  body: { error: "Timeout" }
});

// Works with .handle() too
intercept.get("/data").delay(200).handle(({ params }) => {
  return Response.json({ data: "delayed" });
});
```

**Example: Testing loading states**

```tsx
it("shows spinner while fetching", async () => {
  vi.useFakeTimers();
  
  // Add 500ms delay
  intercept.get("/users").delay(500).resolve([{ id: 1, name: "Ada" }]);

  renderWithQuery(<Users />);

  // Initially shows loading
  expect(screen.getByText("Loading...")).toBeInTheDocument();

  // Advance time by 500ms
  await vi.advanceTimersByTimeAsync(500);

  // Loading disappears, data shows
  expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  expect(await screen.findByText("Ada")).toBeInTheDocument();

  vi.useRealTimers();
});
```

### Simulate fetching / pending state

For testing **indefinite loading** or custom response details, use `.fetching()`:

```ts
// Request hangs forever (never resolves) - useful for timeout tests
intercept.get("/slow").fetching();

// Resolve after delay with custom status and headers
intercept.get("/slow").fetching({ 
  delayMs: 500, 
  status: 200, 
  headers: { "x-test": "ok" } 
});
```

**When to use `.delay()` vs `.fetching()`:**
- Use `.delay()` when you want to add a delay before returning normal responses
- Use `.fetching()` when you need to test indefinite hanging or need fine-grained control over the delayed response

### Dynamic resolvers with `.handle()`

Need to compute a response based on the incoming request? Use `.handle()` for full control:

```ts
intercept.post("/login").handle(async ({ request, body, params }) => {
  // body is parsed JSON (best-effort)
  if (body?.username === "admin" && body?.password === "secret") {
    return Response.json({ token: "abc123", user: { id: 1, name: "Admin" } });
  }
  
  return Response.json(
    { error: "Invalid credentials" },
    { status: 401 }
  );
});

// Access request headers
intercept.get("/protected").handle(({ request }) => {
  const auth = request.headers.get("Authorization");
  
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  return Response.json({ data: "secret data" });
});

// Use path params
intercept.delete("/users/:id").handle(({ params }) => {
  console.log(`Deleting user ${params.id}`);
  return new Response(null, { status: 204 });
});
```

---

## Ignoring requests

Ignore requests to given paths across **all HTTP methods**. Handy for analytics, health checks, or any traffic you don't want your tests to care about. Returns **204 No Content** immediately to prevent test failures.

```ts
intercept.ignore(paths: ReadonlyArray<Path>)
```

**Example:**
```ts
// In setupTests.ts or beforeEach
intercept.ignore(['/analytics', '/ping', '/health-check']);

// All these return 204 immediately:
fetch('/analytics');           // GET
fetch('/ping', { method: 'POST' });  // POST
fetch('/health-check');        // any method
```

**Common use cases:**

```ts
// Ignore analytics and monitoring
intercept.ignore([
  '/api/analytics/*',
  '/api/metrics',
  '/api/telemetry'
]);

// Ignore third-party health checks
intercept.ignore([
  '/health',
  '/ready',
  '/livez'
]);
```

---

## Unhandled requests

Configure once when starting the server:

```ts
intercept.listen({ onUnhandledRequest: "error" });
```

### Strategies

- **`"error"`** (recommended for tests): Blocks unhandled requests with 501 status and logs an error
  ```
  [@klogt/intercept] ❌ Unhandled request (error mode)
     → GET https://api.example.com/unknown
  
  No intercept handler matched this request.
  The request was blocked with a 501 response.
  Tip: add one with:
     intercept.get('/unknown').resolve(...)
  ```

- **`"warn"`**: Logs a warning but allows the request to pass through to the real transport
  ```
  [@klogt/intercept] 🚧 Unhandled request
     → GET https://api.example.com/unknown
  
  No intercept handler matched this request.
  Tip: add one with:
     intercept.get('/unknown').resolve(...)
  ```

- **`"bypass"`**: Silently allows requests to pass through (no logging)

- **Function**: Decide dynamically per request
  ```ts
  intercept.listen({
    onUnhandledRequest: ({ request, url }) => {
      // Ignore OPTIONS requests
      if (request.method === 'OPTIONS') return 'bypass';
      
      // Warn about others
      return 'warn';
    }
  });
  ```

---

## Axios adapter (optional)

`@klogt/intercept` can intercept both `fetch` **and** Axios. Simply pass your axios instance to `intercept.listen()`:

```ts
import axios from "axios";

const apiClient = axios.create({
  baseURL: "https://api.example.com"
});

// In setupTests.ts
intercept.listen({
  onUnhandledRequest: 'error',
  adapter: apiClient  // Automatically wrapped and attached
});
```

**No runtime axios dependency**: the adapter's types reference `axios` conditionally so your library/app doesn't pull axios unless you install it yourself.

**How it works**: When you pass an axios instance to the `adapter` option, intercept automatically wraps it with an internal adapter that makes your axios requests go through the same route handlers as fetch requests.

---

## Common Testing Patterns

### Pattern 1: Baseline routes in setup, overrides in tests

```ts
// setupTests.ts
beforeAll(() => {
  intercept
    .listen({ onUnhandledRequest: 'error' })
    .origin('https://api.example.com');
    
  // Baseline routes that apply to all tests
  intercept.get("/config").resolve({ version: "1.0" });
  intercept.get("/health").resolve({ status: "ok" });
});

// users.test.ts
it("fetches users", () => {
  // Override or add specific routes for this test
  intercept.get("/users").resolve([{ id: 1 }]);
  // ... test code
});
```

### Pattern 2: Per-test origin for multi-tenant apps

```ts
describe("Tenant-specific tests", () => {
  beforeEach(() => {
    const tenant = 'acme'; // could be from test context
    intercept.origin(`https://${tenant}.api.example.com`);
  });

  it("fetches tenant data", async () => {
    intercept.get("/data").resolve({ tenant: "acme" });
    // Matches: https://acme.api.example.com/data
  });
});
```

### Pattern 3: Test error scenarios

```ts
it("handles network errors gracefully", async () => {
  intercept.get("/users").reject({
    status: 500,
    body: { error: "Internal server error" }
  });

  const { result } = renderHook(() => useUsers(), {
    wrapper: QueryClientProvider
  });

  await waitFor(() => {
    expect(result.current.error).toBeTruthy();
  });
});

it("handles timeout", async () => {
  // Simulate a request that never completes
  intercept.get("/users").fetching(); // hangs forever

  // Your component should show loading state indefinitely
  // or timeout after your configured limit
});
```

### Pattern 4: Testing authentication flows

```ts
it("redirects to login on 401", async () => {
  intercept.get("/profile").reject({
    status: 401,
    body: { error: "Unauthorized" }
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByText("Please log in")).toBeInTheDocument();
  });
});

it("retries with new token after refresh", async () => {
  let attempt = 0;
  
  intercept.get("/profile").handle(({ request }) => {
    attempt++;
    const auth = request.headers.get("Authorization");
    
    if (attempt === 1 || !auth) {
      return Response.json({ error: "Token expired" }, { status: 401 });
    }
    
    return Response.json({ id: 1, name: "Ada" });
  });

  // Your app should detect 401, refresh token, and retry
  // ... rest of test
});
```

### Pattern 5: Ignoring non-essential requests

```ts
beforeEach(() => {
  // Ignore analytics so they don't cause test failures
  intercept.ignore([
    '/api/analytics/*',
    '/api/tracking',
    '/health'
  ]);
});
```

---

## API reference

### `intercept.listen(options)`

Start intercepting. Must be called before defining routes.

```ts
intercept.listen({
  onUnhandledRequest?: "warn" | "bypass" | "error" | ((args) => Strategy);
});
```

Returns `intercept` for chaining with `.origin()`.

### `intercept.origin(url)`

Set the base URL for relative paths. Can be called in `beforeAll` (applies to whole file) or `beforeEach` (per-test).

```ts
intercept.origin('https://api.example.com');
```

Returns `intercept` for chaining.

### `intercept.<method>(path)`

Create a route for `GET | POST | PUT | PATCH | DELETE | OPTIONS`.

```ts
intercept.get(path: Path)
intercept.post(path: Path)
intercept.put(path: Path)
intercept.patch(path: Path)
intercept.delete(path: Path)
intercept.options(path: Path)
```

Each returns an object with:

#### `.delay(ms)`

Add a delay before responding. Returns a chainable object with resolve/reject/handle methods:

```ts
delay(ms: number): {
  resolve<T>(data: T, init?: ResolveInit): void;
  reject<T>(opts?: RejectInit<T>): void;
  handle<TRequest>(resolver: DynamicResolver<TRequest>): void;
}
```

**Example:**
```ts
intercept.get("/users").delay(500).resolve([{ id: 1 }]);
intercept.post("/login").delay(1000).reject({ status: 401 });
```

#### `.resolve(data, init?)`

Return successful JSON response:

```ts
resolve<T>(data: T, init?: {
  status?: number;      // Default: method-specific (200, 201, 204)
  headers?: Record<string, string>;
}): void;
```

If `status` is `204`, body is stripped automatically.

#### `.reject(opts?)`

Return error response:

```ts
reject<T>(opts?: {
  status?: number;      // Default: 400
  body?: T | undefined; // Optional error body
  headers?: Record<string, string>;
}): void;
```

#### `.fetching(init?)`

Simulate pending/loading state:

```ts
fetching(init?: {
  delayMs?: number;     // Undefined = hang forever
  status?: number;      // Default: 204
  headers?: Record<string, string>;
}): void;
```

#### `.handle(resolver)`

Full control with custom logic:

```ts
handle<TRequest>(
  resolver: (args: {
    request: Request;
    url: URL;
    params: Record<string, string>;
    body: TRequest | undefined;  // Parsed JSON, best-effort
  }) => Response | Promise<Response>
): void;
```

### `intercept.ignore(paths)`

Ignore requests to given paths across all HTTP methods:

```ts
intercept.ignore(paths: ReadonlyArray<Path>): void;
```

Returns 204 No Content immediately.

### `intercept.reset()`

Clear all registered handlers. Use in `afterEach` for test isolation:

```ts
afterEach(() => {
  intercept.reset();
});
```

### `intercept.close()`

Stop intercepting, detach adapters, restore globals, and clear all state. Use in `afterAll`:

```ts
afterAll(() => {
  intercept.close();
});
```

### `createSetup(options)`

Create a test setup helper that reduces boilerplate. Returns an object with lifecycle methods:

```ts
createSetup(options: ListenOptions): {
  start: () => void;
  reset: () => void;
  close: () => void;
}
```

**Parameters:**
- `options`: Same as `intercept.listen()` - can include `origin` and `onUnhandledRequest`

**Example:**
```ts
// setupTests.ts
import { createSetup } from "@klogt/intercept";

const setup = createSetup({
  origin: 'https://api.example.com',
  onUnhandledRequest: 'error'
});

beforeAll(setup.start);
afterEach(setup.reset);
afterAll(setup.close);
```

---

## Troubleshooting

### "No intercept handler matched this request"

This error means you tried to make a request that doesn't have a matching route. The error message now includes helpful context:

```
[@klogt/intercept] ❌ Unhandled request (error mode)
   → GET https://api.example.com/user

No intercept handler matched this request.
The request was blocked with a 501 response.

Registered handlers:
  GET /users
  POST /users
  GET /profile

Did you mean: GET /users?
```

**Common causes:**

1. **Forgot to set origin** for relative paths:
   ```ts
   // ❌ This won't work
   intercept.get("/users").resolve([...]);
   await fetch('/users');  // Error: no handler matched
   
   // ✅ Set origin first
   intercept.origin('https://api.example.com');
   intercept.get("/users").resolve([...]);
   await fetch('/users');  // Works!
   ```

2. **Path mismatch** (typo or wrong params):
   ```ts
   intercept.get("/users").resolve([...]);
   await fetch('/user');  // ❌ Typo - check "Did you mean?" suggestion
   ```

3. **Method mismatch**:
   ```ts
   intercept.get("/users").resolve([...]);
   await fetch('/users', { method: 'POST' });  // ❌ Handler is for GET
   ```

**Tip**: The error message now shows all registered handlers and may suggest the closest match to help you spot typos quickly!

### "Cannot find module 'axios' or its type declarations"

You don't need axios unless you attach the adapter. If you see this error:

1. Either install axios: `npm i axios`
2. Or don't import from `@klogt/intercept/axios`

The axios adapter uses conditional type imports to avoid a hard dependency.

### ESM/CJS issues

This package targets **ES Modules**. If your runner enforces CJS:

1. Enable ESM support in your test runner
2. Or transpile the package in your build config

### Tests are flaky or handlers leak between tests

Always call `intercept.reset()` in `afterEach`:

```ts
afterEach(() => {
  intercept.reset();
});
```

This ensures each test starts with a clean slate.

### Relative paths don't work

Make sure you've called `.origin()`:

```ts
// In setupTests.ts or beforeAll
intercept
  .listen({ onUnhandledRequest: 'error' })
  .origin('https://api.example.com');
```

Or use absolute URLs:

```ts
intercept.get("https://api.example.com/users").resolve([...]);
```

---

## Comparison with MSW

If you're familiar with [MSW](https://mswjs.io/), here's how `@klogt/intercept` compares:

| Feature | @klogt/intercept | MSW |
|---------|------------------|-----|
| **Setup complexity** | Minimal - one setup file | Requires worker setup |
| **Native fetch support** | Built-in (Node 20+) | Via msw/node |
| **Route definition** | Inline in tests | Inline or separate handlers |
| **Path params** | `:param` syntax | `:param` syntax |
| **TypeScript** | First-class, no `any` | Good support |
| **Browser support** | No (test-only) | Yes |
| **Bundle size** | Small | Larger |
| **Maturity** | New | Established |

**Choose @klogt/intercept if:**
- You only need test interception (not browser)
- You want minimal setup
- You prefer Node 20+ native features
- You want a lightweight package

**Choose MSW if:**
- You need browser support (dev mode mocking)
- You want battle-tested stability
- You need advanced features like streaming

---

## Advanced Usage

### Creating custom adapters

You can create your own adapters for other HTTP clients:

```ts
import type { Adapter, CoreForAdapter } from "@klogt/intercept";

function createMyAdapter(client: MyClient): Adapter {
  return {
    attach(core: CoreForAdapter) {
      // Wrap client's request method
      const originalRequest = client.request;
      
      client.request = async (config) => {
        const req = configToRequest(config);
        const result = await core.tryHandle(req);
        
        if (result.matched) {
          return responseToClient(result.res);
        }
        
        // Unhandled - decide what to do
        return originalRequest.call(client, config);
      };
    },
    
    detach() {
      // Restore original method
    }
  };
}
```

### Type-safe responses

Use TypeScript generics for type-safe responses:

```ts
type User = { id: number; name: string };

intercept.get("/users").resolve<User[]>([
  { id: 1, name: "Ada" },
  { id: 2, name: "Grace" }
]);

// Type error if response doesn't match
intercept.get("/users").resolve<User[]>([
  { id: 1 }  // ❌ Error: missing 'name'
]);
```

### Conditional responses

Use `.handle()` for complex conditional logic:

```ts
let callCount = 0;

intercept.get("/users").handle(() => {
  callCount++;
  
  if (callCount === 1) {
    return Response.json({ error: "First call fails" }, { status: 500 });
  }
  
  return Response.json([{ id: 1, name: "Ada" }]);
});

// First call fails, second succeeds
```

---

## Contributing

Contributions are welcome! Please open an issue or PR on [GitHub](https://github.com/klogt-as/intercept).

---

## License

MIT © [Klogt](https://github.com/klogt-as)
