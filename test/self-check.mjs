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

console.log("\n=== registry validation ===");

check("policies sharing a policy_id are rejected", () => {
  const root = fileURLToPath(new URL("./fixtures/duplicate-policy-id", import.meta.url));
  const messages = [];
  const errors = validateRegistry(root, (rec) => {
    if (rec.ok === false) messages.push(rec.msg);
  });
  expectEqual(errors, 1);
  if (!/policy_id "fixture_policy_v1" is used by both/.test(messages[0])) {
    throw new Error(`unexpected failure: ${messages[0]}`);
  }
});

console.log(`\n${failures === 0 ? "Self-check passed." : `${failures} self-check failure(s).`}`);
process.exit(failures === 0 ? 0 : 1);
