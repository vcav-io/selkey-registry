#!/usr/bin/env node

/**
 * Registry validation script — runs three checks per artefact:
 * 1. Digest verification: SHA-256(JCS(parse(file))) == filename digest
 * 2. Type validation: payload validates against _schemas/<kind>.schema.json
 * 3. Index consistency: every file has an index entry; every entry has a file;
 *    aliases and channels resolve to existing entries
 */

import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import Ajv from "ajv";

// JCS canonicalization (RFC 8785) — JSON.stringify with sorted keys
function canonicalize(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]));
  return "{" + pairs.join(",") + "}";
}

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const registryJson = JSON.parse(readFileSync(join(ROOT, "registry.json"), "utf8"));

const ajv = new Ajv({ allErrors: true });
let errors = 0;

// Map kind to directory name (handles irregular plurals)
function kindDir(kind) {
  if (kind === "policy") return "policies";
  return kind + "s";
}

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  errors++;
}

function pass(msg) {
  console.log(`  OK: ${msg}`);
}

for (const kind of registryJson.kinds) {
  const indexPath = join(ROOT, registryJson.indexes[kind]);
  console.log(`\n=== ${kind} ===`);

  if (!existsSync(indexPath)) {
    fail(`index file missing: ${indexPath}`);
    continue;
  }

  const index = JSON.parse(readFileSync(indexPath, "utf8"));

  // Load type-validation schema
  const schemaPath = join(ROOT, "_schemas", `${kind}.schema.json`);
  let validate = null;
  if (existsSync(schemaPath)) {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    validate = ajv.compile(schema);
  } else {
    fail(`type-validation schema missing: ${schemaPath}`);
  }

  const indexDigests = new Set(Object.keys(index.artefacts));
  const fileDigests = new Set();

  // Check each artefact entry
  for (const [digest, entry] of Object.entries(index.artefacts)) {
    const hex = digest.replace("sha256:", "");
    const filename = `sha256-${hex}.json`;
    const filePath = join(ROOT, kindDir(kind), filename);

    if (!existsSync(filePath)) {
      fail(`${entry.id}: payload file missing — ${filename}`);
      continue;
    }

    fileDigests.add(digest);

    // 1. Digest verification
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const canonical = canonicalize(parsed);
    const computed = createHash("sha256").update(canonical).digest("hex");
    const expectedHex = hex;

    if (computed !== expectedHex) {
      fail(`${entry.id}: digest mismatch — expected ${expectedHex}, got ${computed}`);
    } else {
      pass(`${entry.id}: digest verified`);
    }

    // 2. Type validation
    if (validate) {
      const valid = validate(parsed);
      if (!valid) {
        fail(`${entry.id}: type validation failed — ${ajv.errorsText(validate.errors)}`);
      } else {
        pass(`${entry.id}: type validation passed`);
      }
    }

    if (kind === "profile") {
      if (parsed.profile_id !== entry.id) {
        fail(
          `${entry.id}: profile payload profile_id "${parsed.profile_id}" must match index entry id`
        );
      }
    }
  }

  // 3a. Check aliases resolve to existing entries
  if (index.aliases) {
    for (const [alias, target] of Object.entries(index.aliases)) {
      if (!indexDigests.has(target)) {
        fail(`alias "${alias}" points to unknown digest ${target}`);
      }
      if (kind === "profile") {
        const entry = index.artefacts[target];
        if (entry && alias !== entry.id) {
          fail(
            `profile alias "${alias}" must match index entry id "${entry.id}" for ${target}`
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
  // Read directory to find all sha256-*.json files
  const { readdirSync } = await import("node:fs");
  const dir = join(ROOT, kindDir(kind));
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

console.log(`\n${errors === 0 ? "All checks passed." : `${errors} error(s) found.`}`);
process.exit(errors === 0 ? 0 : 1);
