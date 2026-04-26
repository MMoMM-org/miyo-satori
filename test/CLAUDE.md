# test/ — Test Area Rules

## Naming
- File: `<module>.test.ts` — mirrors src/ structure
- describe/it: `describe('<unit>') it('<behavior>')`

## Coverage expectations
- All public interfaces must have tests
- Happy path + at least one error path per function

## Test data
- Use fixtures/factories, not hardcoded production-like data
- Isolate: each test creates its own data; don't share mutable state

## Runner
- Vitest (`npm test` → `vitest run`); config at `vitest.config.ts`
