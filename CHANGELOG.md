# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
