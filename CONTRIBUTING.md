# Contributing to the Selkey Registry

## Submitting an artefact

1. **Create the payload file** — pure JSON matching the type-validation schema in `_schemas/<kind>.schema.json`. No metadata envelope; the file contains exactly the artefact payload.

2. **Compute the digest**:
   - Parse the JSON
   - Canonicalize with JCS (RFC 8785)
   - SHA-256 hash the canonical form
   - Name the file `sha256-<hex>.json`

3. **Add an index entry** in `<kind>s/index.json`:
   ```json
   {
     "sha256:<hex>": {
       "id": "your_artefact_id",
       "version": "1.0.0",
       "description": "What this artefact does",
       "status": "experimental",
       "published_at": "2026-03-07",
       "compatibility": {}
     }
   }
   ```

4. **Add an alias** (optional but recommended):
   ```json
   "aliases": {
     "your_artefact_id": "sha256:<hex>"
   }
   ```

5. **Open a pull request**. CI will validate digest, type schema, and index consistency.

## Rules

- **Aliases are immutable.** Once created, an alias always points to the same digest. New versions get new aliases.
- **Artefacts are append-only.** Entries are never removed. Set `status` to `"deprecated"` to signal an artefact should not be used in new contracts.
- **Channels are mutable.** `name@latest` pointers may be retargeted. Do not rely on channels for reproducible contract construction — use aliases or raw digests.
- **Status values**: `"active"`, `"experimental"`, `"deprecated"`.

## Profile-specific guidance

Profiles are content-addressed artefacts. In this registry, that means:

- the digest is authoritative
- `profile_id` is human-readable metadata carried inside the payload
- the profile index alias should match the payload's `profile_id`
- policy and contract references should prefer the profile digest when a machine-verifiable reference is needed

Treat semantic IDs as readability and migration aids, not as the long-term trust anchor.

## Compatibility metadata

Schemas and policies should declare a `safety_class` in their `compatibility` object:

- `"SAFE"` — enum-only output, no free text, deterministic policy gate
- `"RICH"` — may include bounded free text, must declare explicit entropy controls

The contract builder validates that a `SAFE` policy is not paired with a `RICH` schema.
