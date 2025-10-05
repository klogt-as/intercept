# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.3] - 2025-05-10

### Fixed
- Fixed axios adapter not properly extracting custom error messages from `intercept.reject()` responses. Error messages now correctly propagate through AxiosError to React Query and other error handlers.

### Added
- Added `code`, `request`, and `toJSON` properties to `MinimalAxiosError` type for better axios compatibility
- Added axios (v1.12.2) as devDependency for compile-time type compatibility verification
- Added `TYPE_TESTING.md` documentation explaining the type testing strategy and CI integration
- Added `TYPE_ALIGNMENT.md` documentation explaining type design decisions and maintenance guidelines
- Added comprehensive JSDoc documentation to all axios adapter types explaining design decisions

### Changed
- Rewrote `axios-types.test-d.ts` with proper compile-time type assertions using TypeScript's type system
- Enhanced `MinimalAxiosError` to include all properties that axios error handlers typically check
- Type compatibility tests now verify core fields, error handling patterns, and real-world usage scenarios
- Improved type safety by documenting intentional differences from axios types

### Technical Details
- The `responseToAxios` function now extracts custom error messages from `response.data.message` when available
- Type tests now use `Extends<>` utility for proper compile-time type compatibility checking
- Tests verify that MinimalAxiosResponse, MinimalAxiosConfig, and MinimalAxiosError remain compatible with axios types
- CI integration ensures type compatibility checks run before publishing via `pnpm typecheck`
- Type tests document intentional differences (e.g., more permissive header types)
- Type compatibility tests will fail at compile time if types drift from axios, preventing bugs before they reach production

## [1.0.2] - 2025-04-10

### Fixed
- Fixed axios adapter not intercepting real axios instances. The type guard in `src/adapters/types.ts` now correctly identifies axios instances as functions with properties, not just plain objects. This resolves an issue where the adapter was silently skipped when using real axios instances.

### Technical Details
- Updated `isAxiosLikeInstance()` type guard to accept both `typeof value === "object"` and `typeof value === "function"`
- All existing tests continue to pass with no regressions
- Axios adapter now successfully intercepts requests from real axios instances

## [1.0.1] - 2025-04-09

### Added
- Initial public release of `@klogt/intercept`
- MSW-inspired HTTP interception for Node.js 20+ testing
- Native fetch support with zero dependencies
- Optional axios adapter for intercepting axios requests
- Comprehensive test coverage
- Full TypeScript support with type inference

### Features
- Route declaration with `.resolve()`, `.reject()`, `.handle()`, and `.fetching()`
- Path parameter support (e.g., `/users/:id`)
- Delay simulation for testing loading states
- Multiple unhandled request strategies (`error`, `warn`, `bypass`)
- Works with Vitest, Jest, React Testing Library, and TanStack Query
- Automatic JSON serialization and content-type handling

## [1.0.0] - 2025-04-09

### Added
- Initial development release (not published to npm)
