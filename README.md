# Selkey Registry

Content-addressed artefact registry for [Selkey](https://github.com/vcav-io/selkey) bounded-disclosure contracts.

## What this is

A shared, append-only collection of canonical artefacts that agents reference when constructing contracts. Each artefact is identified by its SHA-256 digest over JCS-canonicalized (RFC 8785) JSON.

**This registry defines what exists.** Relay operators independently decide which artefacts they admit and execute via their local `relay-admission.toml`.

## Artefact kinds

| Kind | Directory | Description |
|------|-----------|-------------|
| `schema` | `schemas/` | JSON Schema for output validation |
| `policy` | `policies/` | Enforcement policy (rules, entropy constraints) |
| `profile` | `profiles/` | Model/provider configuration |
| `program` | `programs/` | Prompt template + assembly logic |

## Structure

```
selkey-registry/
+-- registry.json              # top-level manifest
+-- _schemas/                   # type-validation schemas (used by CI)
+-- schemas/
|   +-- index.json              # per-kind index with aliases and channels
|   +-- sha256-<hex>.json       # payload files (content-addressed)
+-- policies/
+-- profiles/
+-- programs/
```

## Digest rules

- **Algorithm**: SHA-256
- **Input**: JCS (RFC 8785) canonicalization of the parsed JSON payload
- **Qualified form**: `sha256:<hex>` (in indexes, contracts, allowlists)
- **Filenames**: `sha256-<hex>.json` (hyphen for filesystem safety)

## Profile identity rules

Profiles follow the same content-addressing rule as every other artefact kind:

- the profile digest is the authoritative identifier for interoperable references
- `profile_id` is human-readable metadata inside the payload, not the trust anchor
- profile aliases and channels are convenience pointers to a digest, not an alternative authority

That means:

- contracts and receipts should treat `model_profile_hash` as authoritative
- policy allowlists should prefer hash entries (`sha256:<hex>` or raw hex where a local format requires it)
- semantic IDs remain useful for readability, UI, and migration, but should not be treated as the source of truth when a hash is present

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Validation

```bash
npm ci
npm run validate
```

CI runs three checks per artefact: digest verification, type validation against `_schemas/`, and index consistency (aliases, channels, orphan detection).
