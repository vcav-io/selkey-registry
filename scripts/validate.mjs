#!/usr/bin/env node

/**
 * Registry validation script — runs three checks per artefact:
 * 1. Digest verification: SHA-256(JCS(parse(file))) == filename digest.
 *    Parsing is strict: duplicate keys, lone surrogates and malformed UTF-8
 *    are rejected (RFC 8785 requires I-JSON input).
 * 2. Type validation: payload validates against _schemas/<kind>.schema.json
 * 3. Index consistency: every file has an index entry; every entry has a file;
 *    aliases and channels resolve to existing entries; payload ids match
 *    their index entry ids and are unique within a kind
 */

import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { decodeUtf8, parseStrictJson, canonicalize } from "./jcs.mjs";

// Payload field carrying the human-readable id, for kinds where the index
// entry id must equal it (and therefore be unique per payload).
const PAYLOAD_ID_FIELD = {
  policy: "policy_id",
  profile: "profile_id",
};

// Map kind to directory name (handles irregular plurals)
function kindDir(kind) {
  if (kind === "policy") return "policies";
  return kind + "s";
}

function readStrictJson(path) {
  return parseStrictJson(decodeUtf8(readFileSync(path)));
}

/**
 * Validate the registry rooted at `root`. Returns the number of errors.
 * `log` receives { ok: boolean, msg: string } records. Type-validation
 * schemas are read from `schemaRoot`/_schemas (defaults to `root`).
 */
export function validateRegistry(root, log = defaultLog, schemaRoot = root) {
  let errors = 0;
  const fail = (msg) => {
    log({ ok: false, msg });
    errors++;
  };
  const pass = (msg) => log({ ok: true, msg });

  const registryJson = readStrictJson(join(root, "registry.json"));
  const ajv = new Ajv({ allErrors: true });

  for (const kind of registryJson.kinds) {
    const indexPath = join(root, registryJson.indexes[kind]);
    log({ section: kind });

    if (!existsSync(indexPath)) {
      fail(`index file missing: ${indexPath}`);
      continue;
    }

    let index;
    try {
      index = readStrictJson(indexPath);
    } catch (e) {
      fail(`index ${registryJson.indexes[kind]}: invalid JSON — ${e.message}`);
      continue;
    }

    // Load type-validation schema
    const schemaPath = join(schemaRoot, "_schemas", `${kind}.schema.json`);
    let validate = null;
    if (existsSync(schemaPath)) {
      validate = ajv.compile(readStrictJson(schemaPath));
    } else {
      fail(`type-validation schema missing: ${schemaPath}`);
    }

    const indexDigests = new Set(Object.keys(index.artefacts));
    const idField = PAYLOAD_ID_FIELD[kind];
    const payloadIds = new Map(); // payload id -> first digest seen

    // Check each artefact entry
    for (const [digest, entry] of Object.entries(index.artefacts)) {
      const hex = digest.replace("sha256:", "");
      const filename = `sha256-${hex}.json`;
      const filePath = join(root, kindDir(kind), filename);

      if (!existsSync(filePath)) {
        fail(`${entry.id}: payload file missing — ${filename}`);
        continue;
      }

      let parsed;
      try {
        parsed = readStrictJson(filePath);
      } catch (e) {
        fail(`${entry.id}: invalid JSON in ${filename} — ${e.message}`);
        continue;
      }

      // 1. Digest verification
      let computed;
      try {
        computed = createHash("sha256").update(canonicalize(parsed)).digest("hex");
      } catch (e) {
        fail(`${entry.id}: cannot canonicalize ${filename} — ${e.message}`);
        continue;
      }

      if (computed !== hex) {
        fail(`${entry.id}: digest mismatch — expected ${hex}, got ${computed}`);
      } else {
        pass(`${entry.id}: digest verified`);
      }

      // 2. Type validation
      if (validate) {
        if (!validate(parsed)) {
          fail(`${entry.id}: type validation failed — ${ajv.errorsText(validate.errors)}`);
        } else {
          pass(`${entry.id}: type validation passed`);
        }
      }

      if (idField) {
        const payloadId = parsed[idField];
        if (payloadId !== entry.id) {
          fail(
            `${entry.id}: ${kind} payload ${idField} "${payloadId}" must match index entry id`
          );
        }
        if (payloadIds.has(payloadId)) {
          fail(
            `${kind} ${idField} "${payloadId}" is used by both ${payloadIds.get(payloadId)} and ${digest}; each ${kind} version needs its own id`
          );
        } else {
          payloadIds.set(payloadId, digest);
        }
      }
    }

    // 3a. Check aliases resolve to existing entries
    if (index.aliases) {
      for (const [alias, target] of Object.entries(index.aliases)) {
        if (!indexDigests.has(target)) {
          fail(`alias "${alias}" points to unknown digest ${target}`);
        }
        if (idField) {
          const entry = index.artefacts[target];
          if (entry && alias !== entry.id) {
            fail(
              `${kind} alias "${alias}" must match index entry id "${entry.id}" for ${target}`
            );
          }
        }
      }
    }

    // 3b. Check channels resolve to existing entries
    if (index.channels) {
      for (const [channel, target] of Object.entries(index.channels)) {
        if (!indexDigests.has(target)) {
          fail(`channel "${channel}" points to unknown digest ${target}`);
        }
      }
    }

    // 3c. Check for orphan files (files without index entries)
    const dir = join(root, kindDir(kind));
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(
        (f) => f.startsWith("sha256-") && f.endsWith(".json")
      );
      for (const f of files) {
        const hex = f.replace("sha256-", "").replace(".json", "");
        const digest = `sha256:${hex}`;
        if (!indexDigests.has(digest)) {
          fail(`orphan file ${f} — no index entry for ${digest}`);
        }
      }
    }
  }

  return errors;
}

function defaultLog(rec) {
  if (rec.section) console.log(`\n=== ${rec.section} ===`);
  else if (rec.ok) console.log(`  OK: ${rec.msg}`);
  else console.error(`  FAIL: ${rec.msg}`);
}

const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  const root = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
  const errors = validateRegistry(root);
  console.log(`\n${errors === 0 ? "All checks passed." : `${errors} error(s) found.`}`);
  process.exit(errors === 0 ? 0 : 1);
}
