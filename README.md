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

## Features

- **Zero server**: intercepts Node 20+ native `fetch` directly
- **Route DSL**: `intercept.get('/users').resolve([{ id: 1 }])`
- **Smart defaults**: e.g., `POST` → `201` by default, `DELETE` → `204`
- **Unhandled strategies**: warn, bypass, or error
- **Composable**: `server.use(...)`, `server.resetHandlers()`, `server.close()`
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
The recommended way is to create a shared setup file (e.g. `setupTests.ts`) and call `server.listen()` there:

```ts
// setupTests.ts
import { server } from "@klogt/intercept";

beforeAll(() => {
  server.listen({ baseUrl: "http://localhost" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
```

Create a test file, e.g. `tests/users.test.ts`:

```ts
it("renders users from API", async () => {
  // Example routes you can reuse per test or override in tests
  intercept.get("/users").resolve([{ id: 1, name: "Ada" }]);
  // Your component calls fetch('/users') underneath
  // The declared route above returns 200 with the JSON array
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
  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await fetch("/users");
      if (!res.ok) throw new Error("Network error");
      return res.json();
    },
  });

  if (isLoading) return <div>Loading...</div>;
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

it("renders mocked users", async () => {
  // Declare a mock response for GET /users
  intercept.get("/users").resolve([
    { id: 1, name: "Ada" },
    { id: 2, name: "Grace" },
  ]);

  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Users />
    </QueryClientProvider>
  );

  expect(await screen.findByText("Ada")).toBeInTheDocument();
  expect(await screen.findByText("Grace")).toBeInTheDocument();
});
```

This way, your component and React Query behave as if the API responded, but everything is handled in-memory with `@klogt/intercept`.

---

## Defining routes

```ts
// GET /users → 200 with array
intercept.get("/users").resolve([{ id: 1 }]);

// POST /users → 201 with body
intercept.post("/users").resolve({ id: 2, name: "Grace" });

// DELETE /users/2 → 204 (no content) – body is ignored when status = 204
intercept.delete("/users/:id").resolve(null, { status: 204 });

// Provide headers or override status
intercept.get("/profile").resolve({ id: "me" }, {
  status: 200,
  headers: { "x-test": "ok" },
});
```

### Simulate fetching / pending state

Sometimes you want to test a **loading state** by simulating a request that never resolves, or resolves after a delay.  
Use `.fetching()`:

```ts
// Request hangs forever (never resolves)
intercept.get("/slow").fetching();

// Resolves after 800ms with status 204 (no content)
intercept.get("/slow").fetching({ delayMs: 800 });

// Resolve after 500ms with a 200 + custom headers
intercept.get("/slow").fetching({ delayMs: 500, status: 200, headers: { "x-test": "ok" } });
```

Example with React:

```tsx
// In your test
it("shows loading state while fetching", async () => {
  intercept.get("/users").fetching({ delayMs: 800 });


  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Users />
    </QueryClientProvider>
  );

  // Immediately see the loading indicator
  expect(screen.getByText("Loading...")).toBeInTheDocument();

  // After ~800ms the query resolves and data appears
  expect(await screen.findByText("Ada")).toBeInTheDocument();
});
```

---

### Path params & wildcards

- `":id"` style params are supported: `"/users/:id"`
- Catch-all: `"/*"` (relative to your `baseUrl`)

Access to `request`, `url`, `params`, and parsed `json` is available in dynamic resolvers (see below).

### Dynamic resolvers

Need to compute a response from the incoming request?

```ts
intercept.post("/login").resolve(async (_json, { request, url, params }) => {
  const body = await request.clone().json();
  if (body.username === "admin") {
    return { token: "dev" };
  }
  return new Response("Unauthorized", { status: 401 });
});
```

> If you return a plain object, it's sent as JSON with defaults. Return a `Response` to take full control.

---

## Ignoring requests

Ignore requests to given paths across **all HTTP methods**. Handy for analytics, health checks, or any traffic you don't want your tests to care about. Returns **204 No Content** immediately to prevent test failures.

```typescript
intercept.ignore(paths: ReadonlyArray<Path>)
```

**Example:**
```typescript
// Ignore analytics and health check endpoints
intercept.ignore(['/analytics', '/ping', '/health-check']);

// Must be called inside a beforeEach
beforeEach(() => {
  intercept.ignore(['/metrics', '/analytics/*']);
});
```

All HTTP methods (GET, POST, PUT, PATCH, DELETE, OPTIONS) are automatically handled for each ignored path.

---

## Unhandled requests

Configure once when starting the server:

```ts
server.listen({ onUnhandledRequest: "warn" });
// "warn": console.warn + delegate to real transport
// "bypass": silently delegate
// "error": throw or return 501 (depending on adapter)
```

---

## Axios adapter (optional)

`@klogt/intercept` can intercept both `fetch` **and** a specific Axios instance you choose to attach.

```ts
import axios from "axios";
import { createAxiosAdapter } from "@klogt/intercept/axios";

const instance = axios.create({ baseURL: "http://localhost" });
server.attachAdapter(createAxiosAdapter(instance));
```

**No runtime axios dependency**: the adapter's types reference `axios` conditionally so your library/app doesn't pull axios unless you install it yourself.

---

## API reference (essentials)

### `server.listen(options)`

Start intercepting.

```ts
server.listen({
  baseUrl?: string; // default: "http://localhost"
  onUnhandledRequest?: "warn" | "bypass" | "error" | ((req) => Strategy);
});
```

### `server.use(...handlers)`

Register additional handlers (rarely needed directly — use `intercept.*`).

### `server.resetHandlers()`

Clear handlers added since `listen()` (keeps the initial ones if any).

### `server.close()`

Stop intercepting and restore globals/adapters.

### `server.attachAdapter(adapter)`

Attach a client adapter (e.g. Axios) so routes apply to that client as well.

### `intercept.<method>(path)`

Create a route for `GET | POST | PUT | PATCH | DELETE | OPTIONS`.

Returns an object with:

```ts
resolve<T>(jsonOrResolver: T | DynamicResolver<T>, init?: {
  status?: number;
  headers?: Record<string, string>;
}): void;
```

If `status` is `204`, any body is stripped.

### `intercept.ignore(paths)`

Ignore requests to given paths across all HTTP methods.

```ts
intercept.ignore(paths: ReadonlyArray<Path>): void;
```

---

## Testing patterns

- Put `server.listen/resetHandlers/close` in a dedicated **setup file** and reference it from your test runner config.
- Define **baseline routes** in the setup and **override** within individual tests as needed.
- Use `onUnhandledRequest: "error"` locally to smoke out missing handlers.
- Use `intercept.ignore()` to silence analytics, health checks, or other unimportant traffic.

---

## Troubleshooting

### "Cannot find module 'axios' or its type declarations"

You don't need axios unless you attach the adapter. If your TS setup still tries to resolve axios types, make sure you're not importing from `@klogt/intercept/axios` unless axios is installed. The adapter itself uses a conditional type import to avoid a hard dependency.

### ESM/CJS

This package targets **ES Modules**. If your runner enforces CJS, enable ESM support or transpile accordingly.

### Node version

Requires **Node 20+** (native `fetch`). Older Node versions are unsupported.

---

## Roadmap

- **HTTP record/replay helpers**
- **Devtools-style inspector for requests/responses**

### DX improvements (planned)

- **Subtle warnings for unhandled requests**  
  Reduce terminal noise by making warnings less intrusive, while still visible.  

- **Better support for relative paths**  
  Improve type hints so developers can see how relative paths resolve with `baseUrl` from config in server.listen({ baseUrl: "http://pokeApi"}).  
  ```ts
  intercept.get("/api/v2/pokemon");
  // Hint: resolved full URL → http://pokeApi/api/v2/pokemon
  ```

- **Clearer type errors for URL paths**  
  Replace cryptic TS errors with actionable hints.  
  ```
  URL paths in intercept must start with "/". Did you mean "/api/v2/pokemon"?
  ```

- **Documentation for server setup in tests**  
  Add README examples for using `setupTest.ts` / `setup.test.ts`, showing that  
  `server.listen()` must be called for `intercept` to work.  

- **Typed response examples in README**  
  Show how to specify the response type to prevent debugging issues:  
  ```ts
  intercept.get("/api/v2/pokemon").resolve<{ results: Pokemon[] }>({
    results: [
      { name: "bulbasaur" },
      { name: "ivysaur" },
      { name: "venusaur" },
    ],
  });
  ```
---

## License

MIT © Klogt