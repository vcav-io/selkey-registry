#!/usr/bin/env node

/**
 * Self-check for scripts/validate.mjs and scripts/jcs.mjs.
 * Runs in CI alongside the registry validation.
 */

import { fileURLToPath } from "node:url";
import { parseStrictJson, canonicalize, decodeUtf8 } from "../scripts/jcs.mjs";
import { validateRegistry } from "../scripts/validate.mjs";

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  OK: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failures++;
  }
}

function expectThrows(fn, pattern) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (!pattern.test(e.message)) {
      throw new Error(`threw "${e.message}", expected ${pattern}`);
    }
  }
  if (!threw) throw new Error("expected an error, none thrown");
}

function expectEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error(`got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

console.log("=== strict JSON / JCS ===");

check("well-formed input canonicalizes", () => {
  const v = parseStrictJson('{"b": [1, {"y": 2, "x": "\\ud83d\\ude00"}], "a": null}');
  expectEqual(canonicalize(v), '{"a":null,"b":[1,{"x":"\u{1F600}","y":2}]}');
});

check("same key in sibling objects is accepted", () => {
  parseStrictJson('[{"k": 1}, {"k": 2}, {"o": {"k": 3}, "k": 4}]');
});

check("duplicate top-level key is rejected", () => {
  expectThrows(() => parseStrictJson('{"policy_id": "a", "policy_id": "b"}'), /duplicate key/);
});

check("duplicate nested key is rejected", () => {
  expectThrows(
    () => parseStrictJson('{"rules": [{"scope": {"kind": "x", "kind": "y"}}]}'),
    /duplicate key/
  );
});

check("duplicate key spelled with an escape is rejected", () => {
  expectThrows(() => parseStrictJson('{"id": 1, "\\u0069d": 2}'), /duplicate key/);
});

check("lone high surrogate in a value is rejected", () => {
  expectThrows(() => parseStrictJson('{"value": "a\\ud800b"}'), /lone surrogate/);
});

check("lone low surrogate in a key is rejected", () => {
  expectThrows(() => parseStrictJson('{"\\udc00": 1}'), /lone surrogate/);
});

check("canonicalize rejects a lone surrogate", () => {
  expectThrows(() => canonicalize({ k: "\ud800" }), /lone surrogate/);
});

check("malformed UTF-8 is rejected", () => {
  expectThrows(() => decodeUtf8(new Uint8Array([0x7b, 0xed, 0xa0, 0x80, 0x7d])), /./);
});

check("leading byte order mark is rejected", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
  expectThrows(() => parseStrictJson(decodeUtf8(bytes)), /not valid JSON|Unexpected/);
});

console.log("\n=== registry validation ===");

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Each fixture registry is valid except for one defect, so validation must
// report exactly one error, matching `pattern`.
function expectSingleFailure(fixture, pattern) {
  const root = fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url));
  const messages = [];
  const errors = validateRegistry(
    root,
    (rec) => {
      if (rec.ok === false) messages.push(rec.msg);
    },
    REPO_ROOT
  );
  expectEqual(errors, 1);
  if (!pattern.test(messages[0])) {
    throw new Error(`unexpected failure: ${messages[0]}`);
  }
}

check("policies sharing a policy_id are rejected", () => {
  expectSingleFailure("duplicate-policy-id", /policy_id "fixture_policy_v1" is used by both/);
});

check("policy_id that differs from its index entry id is rejected", () => {
  expectSingleFailure(
    "policy-id-mismatch",
    /policy payload policy_id "fixture_policy_v1" must match index entry id/
  );
});

check("policy alias that differs from its index entry id is rejected", () => {
  expectSingleFailure(
    "alias-mismatch",
    /policy alias "fixture_policy_latest" must match index entry id "fixture_policy_v1"/
  );
});

check("artefact file with a byte order mark is rejected", () => {
  expectSingleFailure("bom-prefixed-file", /invalid JSON/);
});

check("policy with an omitted optional field is rejected", () => {
  expectSingleFailure("non-canonical-policy", /required property 'max_output_tokens'/);
});

console.log(`\n${failures === 0 ? "Self-check passed." : `${failures} self-check failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
