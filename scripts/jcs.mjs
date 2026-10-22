/**
 * Strict JSON parsing and JCS canonicalization (RFC 8785).
 *
 * RFC 8785 requires I-JSON input (RFC 7493): object member names must be
 * unique and strings must be well-formed Unicode. JSON.parse silently keeps
 * the last of duplicate keys and accepts lone surrogate escapes, so both are
 * checked explicitly here.
 */

/**
 * Decode bytes as UTF-8, rejecting malformed sequences. A leading byte order
 * mark is kept (ignoreBOM) so that JSON parsing rejects it, as RFC 8259 and
 * serde_json do.
 */
export function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

function checkString(s, where) {
  if (!s.isWellFormed()) {
    throw new Error(`string ${where} contains a lone surrogate`);
  }
}

/**
 * Parse JSON text, rejecting duplicate object keys and strings that are not
 * well-formed UTF-16 (lone surrogates). Returns the parsed value.
 */
export function parseStrictJson(text) {
  // Grammar validation is delegated to JSON.parse; the scan below can then
  // assume syntactically valid input.
  const value = JSON.parse(text);

  // Stack of frames: { keys: Set } for objects, null for arrays.
  const stack = [];
  // True when the next string token inside the current object is a key.
  let expectKey = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') {
        j += text[j] === "\\" ? 2 : 1;
      }
      const token = text.slice(i, j + 1);
      const s = JSON.parse(token);
      const top = stack[stack.length - 1];
      if (expectKey && top) {
        checkString(s, `key ${token}`);
        if (top.keys.has(s)) {
          throw new Error(`duplicate key ${JSON.stringify(s)}`);
        }
        top.keys.add(s);
        expectKey = false;
      } else {
        checkString(s, `value ${token}`);
      }
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      stack.push({ keys: new Set() });
      expectKey = true;
    } else if (ch === "[") {
      stack.push(null);
      expectKey = false;
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      expectKey = false;
    } else if (ch === ",") {
      expectKey = Boolean(stack[stack.length - 1]);
    }
    i++;
  }

  return value;
}

/** JCS canonicalization (RFC 8785) of a parsed JSON value. */
export function canonicalize(obj) {
  if (typeof obj === "string") {
    checkString(obj, JSON.stringify(obj));
    return JSON.stringify(obj);
  }
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalize).join(",") + "]";
  }
  // RFC 8785 sorts member names by UTF-16 code units, which is the default
  // Array.prototype.sort order for strings.
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => canonicalize(k) + ":" + canonicalize(obj[k]));
  return "{" + pairs.join(",") + "}";
}
