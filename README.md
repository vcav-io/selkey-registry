# AgentVault Registry

Content-addressed artefact registry for [AgentVault](https://github.com/vcav-io/agentvault) bounded-disclosure contracts.

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
agentvault-registry/
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Validation

```bash
npm ci
npm run validate
```

CI runs three checks per artefact: digest verification, type validation against `_schemas/`, and index consistency (aliases, channels, orphan detection).
