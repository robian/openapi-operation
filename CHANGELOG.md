# Changelog

Notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/) and uses the structure from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Responses with absent or empty content now generate void validators rather
  than unknown validators, including local response references. Empty 200/201
  responses are supported at runtime, unexpected bodies are rejected, and
  explicitly unconstrained JSON responses retain JSON parsing and validation.

### Changed

- Generated response object schemas strip unknown fields instead of rejecting
  them, allowing additive response changes while preserving declared field
  validation. Request bodies remain strict.

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
- A build-time generator for `openapi-typescript` types, per-status Zod
  schemas, and exhaustive operation definitions.
