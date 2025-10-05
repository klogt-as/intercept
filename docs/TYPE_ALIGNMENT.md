# Type Alignment with Axios

This document explains how our minimal axios types align with the official axios types while maintaining zero runtime dependencies.

## Overview

The `@klogt/intercept` library provides an axios adapter without requiring axios as a runtime dependency. To achieve this, we define minimal type definitions that:

1. **Match axios's essential API surface** - User code expecting axios types works seamlessly
2. **Remain dependency-free** - No runtime import of axios required
3. **Are more permissive where appropriate** - Accept common user patterns that axios might reject
4. **Are well-documented** - Clear JSDoc explains intentional differences

## Type Compatibility Testing

We've created `src/adapters/axios-types.test-d.ts` - a type-level test file that:

- Verifies our minimal types are compatible with axios types
- Documents intentional differences
- Tests real-world usage patterns
- Catches breaking changes when axios updates

This file is type-checked by TypeScript but never executed at runtime.

## Key Types

### MinimalAxiosConfig

**Purpose**: Request configuration matching axios's `AxiosRequestConfig`

**Included fields**:
- `url` - Request URL (relative or absolute)
- `baseURL` - Base URL to prepend
- `method` - HTTP method
- `headers` - Request headers (more permissive than axios)
- `data` - Request body
- `params` - URL query parameters
- `validateStatus` - Custom status validation function

**Intentionally omitted**:
- `transformRequest/transformResponse` - Handled by our adapter
- `adapter` - We override this field
- `cancelToken/signal` - Different cancellation model
- `onUploadProgress/onDownloadProgress` - Not supported
- `proxy`, `xsrf`, `maxContentLength` - Node-specific or not needed

### MinimalAxiosResponse

**Purpose**: Response structure matching axios's `AxiosResponse`

**Fields**:
- `data` - Response data (typed generic)
- `status` - HTTP status code
- `statusText` - HTTP status text
- `headers` - Response headers as plain object
- `config` - The request config used
- `request` - Underlying request object (usually null)

### MinimalAxiosError

**Purpose**: Error structure matching axios's `AxiosError`

**Key improvements** (from our bug fix):
- Added `code` property (e.g., "ERR_BAD_RESPONSE")
- Added `request` property
- Added `toJSON()` method for serialization
- Properly extracts custom error messages from response body

**Fields**:
- `isAxiosError` - Always `true` for identification
- `response` - The response that caused the error
- `config` - The request config used
- `code` - Optional error code string
- `request` - Underlying request object
- `toJSON` - Serialization method
- Plus all standard Error properties (message, name, stack)

## Intentional Differences

### Headers Type

**Our type**: `Record<string, string | number | boolean | Date | unknown | Array<...>>`

**Axios type**: `AxiosHeaders` (complex class-based type)

**Why different**:
1. We normalize headers to WHATWG Headers at the adapter boundary
2. We accept more value types (numbers, booleans, arrays) for convenience
3. Users pass headers to us, we don't pass them to axios
4. Simpler to use and understand

**Example**:
```typescript
const config: MinimalAxiosConfig = {
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': 1234,           // number - we allow this
    'X-Feature-Enabled': true,         // boolean - we allow this
    'Set-Cookie': ['a=1', 'b=2']      // array - we allow this
  }
};
```

### Missing Optional Fields

We intentionally omit many axios config fields that are:
- Node.js specific (proxy, httpAgent, httpsAgent, socketPath)
- Not relevant to our use case (transformRequest, transformResponse)
- Handled differently (cancelToken, signal)
- Not supported (onUploadProgress, onDownloadProgress)
- Security-related but app-level (xsrfCookieName, xsrfHeaderName)

These omissions keep the adapter lightweight while supporting 99% of common use cases.

## Type Safety Guarantees

### Compile-Time Checks

The type test file ensures:
1. Our config fields match axios's expected types
2. Our response structure is compatible with axios responses
3. Our errors are compatible with axios error handlers
4. Common usage patterns compile correctly

### Runtime Guarantees

The adapter implementation ensures:
1. All axios-expected properties are present on errors
2. Error messages are extracted correctly from response bodies
3. Status codes and headers are properly propagated
4. The `isAxiosError` flag is always set correctly

## Migration Path

If you're migrating from real axios to our adapter:

1. **No changes needed** for basic usage - types are compatible
2. **Remove unsupported options** if you use advanced features like:
   - Custom transformers
   - Upload/download progress callbacks
   - Node-specific options (proxy, agents)
3. **Update header types** if you have strict typing - our headers are more permissive
4. **Test error handling** - ensure your error handlers work with our error structure

## Future Maintenance

### When Axios Updates

1. Check if axios added commonly-used fields to their types
2. Consider adding those fields to our minimal types
3. Update the type test file to verify compatibility
4. Document any new intentional differences

### Adding New Fields

Before adding a field to our minimal types:
1. Verify it's commonly used (check GitHub issues, Stack Overflow)
2. Ensure it doesn't require runtime axios dependency
3. Document it in JSDoc
4. Add test coverage in the type test file

## Examples

### Error Handling Pattern

```typescript
try {
  await apiClient.get('/api/users');
} catch (error) {
  if (axios.isAxiosError(error)) {
    // TypeScript knows error is MinimalAxiosError
    console.log(error.response.status);      // ✓ Works
    console.log(error.response.data.message); // ✓ Works
    console.log(error.config.url);            // ✓ Works
    console.log(error.code);                  // ✓ Works (optional)
  }
}
```

### React Query Integration

```typescript
const { data, error } = useQuery({
  queryKey: ['users'],
  queryFn: async () => {
    const response = await apiClient.get<User[]>('/api/users');
    return response.data; // ✓ Typed as User[]
  }
});

// Error handling
if (error && axios.isAxiosError(error)) {
  const message = error.response.data.message || 'Unknown error';
  toast.error(message);
}
```

### Custom Config

```typescript
const config: MinimalAxiosConfig = {
  url: '/api/users',
  method: 'POST',
  baseURL: 'https://api.example.com',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer token',
    'X-Request-ID': Date.now(),  // ✓ Number accepted
  },
  data: { name: 'John' },
  params: { filter: 'active' },
  validateStatus: (status) => status < 500,  // ✓ Custom validation
};
```

## Testing

Run type checks:
```bash
npm run typecheck
```

Run all tests:
```bash
npm test
```

The type test file (`axios-types.test-d.ts`) is automatically checked during `typecheck` but never executed.

## Summary

Our minimal axios types provide:
- ✅ **Full compatibility** with common axios usage patterns
- ✅ **Zero runtime dependencies** on axios
- ✅ **Better error messages** through proper type extraction
- ✅ **Comprehensive documentation** of intentional differences
- ✅ **Type safety** verified by compile-time tests
- ✅ **Future-proof** maintenance through automated type checking

This approach ensures users get a seamless axios-like experience while keeping the library lightweight and dependency-free.
