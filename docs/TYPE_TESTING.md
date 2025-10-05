# Type Testing Strategy

This document explains how we verify type compatibility with axios without adding it as a runtime dependency.

## Overview

The `src/adapters/axios-types.test-d.ts` file contains compile-time type checks that verify our minimal types remain compatible with axios types. This provides confidence that our adapter works correctly with real axios instances, even though axios is not a runtime dependency.

## Why Type Testing?

We've experienced bugs in the past where our minimal types drifted from axios's actual types, causing runtime errors for users. Type testing catches these issues at compile time during development and CI.

## How It Works

### 1. axios as devDependency

```json
{
  "devDependencies": {
    "axios": "^1.12.2"
  }
}
```

axios is installed only for type checking - it's never bundled with our library.

### 2. Compile-Time Assertions

The test file uses TypeScript's type system to verify compatibility:

```typescript
// This will fail to compile if the types are incompatible
type _TestResponseCore = Extends<
  PickProps<MinimalAxiosResponse, 'data' | 'status' | 'statusText'>,
  PickProps<AxiosResponse, 'data' | 'status' | 'statusText'>
>;

const _test: _TestResponseCore = true;
```

If types drift, `pnpm typecheck` (run by `tsc --noEmit`) will fail, preventing the issue from reaching production.

### 3. Real-World Pattern Testing

The file also includes actual usage patterns to verify practical compatibility:

```typescript
function handleError(error: unknown): void {
  if (error && typeof error === 'object' && 'isAxiosError' in error) {
    const axiosError = error as MinimalAxiosError;
    const status: number = axiosError.response.status; // Must compile
  }
}
```

## What We Test

### ✅ Core Compatibility
- Response data, status, and statusText types
- Config url, method, data, and params types
- Error isAxiosError flag and critical properties
- Generic type parameters for typed responses

### ✅ Usage Patterns
- Error type narrowing with `isAxiosError`
- Response data access with proper typing
- Config building patterns
- Error handling patterns

### ❌ Not Tested (Intentionally)
- Full structural type equality (headers differ by design)
- Unused axios-specific fields (adapter, transformRequest, proxy, etc.)
- Node-specific options we don't support

## Intentional Type Differences

### Headers Type Mismatch

**Our type:**
```typescript
type MinimalAxiosHeaders = Record<string, string | number | boolean | Date | unknown | array>;
```

**Axios type:**
```typescript
class AxiosHeaders {
  // Complex class with restricted value types
}
```

**Why this is okay:**
- We normalize headers to WHATWG Headers at the adapter boundary
- Our more permissive types accept what users naturally want to pass
- Runtime behavior is correct even though types don't match structurally

### Response Headers Structure

**Our type:**
```typescript
headers: Record<string, string>
```

**Axios type:**
```typescript
headers: AxiosResponseHeaders // Complex branded type
```

**Why this is okay:**
- Simplified header access for users
- Most common use case is reading headers as strings
- Reduces type complexity

## CI Integration

Type checking runs as part of the CI pipeline:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run typecheck && npm test && npm run build"
  }
}
```

Any type incompatibility will cause:
1. `pnpm typecheck` to fail locally
2. CI builds to fail
3. npm publish to be blocked

## Adding New Type Tests

When adding new features to the adapter:

1. **Update the minimal types** in `src/adapters/types.ts`
2. **Add type tests** in `src/adapters/axios-types.test-d.ts`
3. **Run typecheck** with `pnpm typecheck`
4. **Document** any intentional differences

### Example: Adding a new config field

```typescript
// 1. Update types.ts
export type MinimalAxiosConfig = {
  url?: string;
  newField?: string; // New field
  // ...
};

// 2. Add test in axios-types.test-d.ts
type ConfigCoreFields = 'url' | 'newField' | /* ... */;

type _TestConfigCore = Extends<
  PickProps<MinimalAxiosConfig, ConfigCoreFields>,
  PickProps<AxiosRequestConfig, ConfigCoreFields>
>;

const _test: _TestConfigCore = true;

// 3. Document if the types differ intentionally
```

## Troubleshooting

### Type test fails after axios update

If axios updates cause type tests to fail:

1. **Understand the change:** What did axios change?
2. **Assess impact:** Does it affect real usage patterns?
3. **Update our types** if needed, or
4. **Document** if the difference is intentional

### Adding new axios compatibility

If you need to support a new axios feature:

1. Add the field to minimal types
2. Add type test for the new field
3. Update adapter implementation
4. Update runtime tests

## Benefits

✅ **Catch bugs early** - Type errors found at compile time, not runtime  
✅ **No runtime cost** - axios is devDependency only  
✅ **CI protection** - Automated checks prevent regressions  
✅ **Documentation** - Tests document compatibility guarantees  
✅ **Confidence** - Safe to update either our types or axios version

## Limitations

❌ **Not runtime validation** - Only checks types, not behavior  
❌ **Partial coverage** - We test common patterns, not every edge case  
❌ **Maintenance** - Must update when axios types change significantly

## See Also

- [Type Alignment Documentation](./TYPE_ALIGNMENT.md)
- [Adapter Implementation](../src/adapters/axios.ts)
- [Type Definitions](../src/adapters/types.ts)
