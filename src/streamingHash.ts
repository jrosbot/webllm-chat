import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function createStreamingSha256() {
  const hasher = sha256.create();
  return {
    update(chunk: Uint8Array) { hasher.update(chunk); },
    digest() { return bytesToHex(hasher.digest()); },
  };
}
