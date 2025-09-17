export function uid(prefix = "id") {
  // Browser has Web Crypto; modern Node 20/22 also has crypto.randomUUID
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    // @ts-ignore
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  // Safe fallback for any environment (no imports)
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}
