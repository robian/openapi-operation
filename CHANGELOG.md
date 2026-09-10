# Changelog

Notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/) and uses the structure from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Status-exhaustive JSON operation definitions bound to `openapi-typescript` path types.
- Compile-time compatibility checks for request and response Zod schemas.
- Runtime request and status-specific response validation.
- Typed success and error result unions.
- Ordered request middleware compatible with custom fetch implementations.
- Ordered raw-response middleware for conditional application policies.
- Status-indexed response rejection handlers that remove rejected statuses from result unions.
- Type utilities for deriving operation inputs, path/query/body values, results,
  response bodies, and error envelopes.
- Explicit errors for contract and transport failures.
