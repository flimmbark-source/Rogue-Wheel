const hasRandomUUID =
  typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto;

function formatId(prefix: string | undefined, value: string) {
  if (prefix && prefix.length > 0) {
    return `${prefix}_${value}`;
  }
  return value;
}

function randomString(length: number) {
  const target = Number.isFinite(length) ? Math.max(1, Math.floor(length)) : 1;
  let result = "";

  while (result.length < target) {
    result += Math.random().toString(36).slice(2);
  }

  return result.slice(0, target);
}

export function uid(prefix = "id") {
  // Browser has Web Crypto; modern Node 20/22 also has crypto.randomUUID
  if (hasRandomUUID) {
    return formatId(prefix, (globalThis.crypto as Crypto).randomUUID());
  }

  const randomPart = randomString(6);
  const timestampPart = Date.now().toString(36).slice(-4);
  return formatId(prefix, `${randomPart}${timestampPart}`);
}

export function uidShort(options: { prefix?: string; length?: number } = {}) {
  const { prefix, length = 8 } = options;
  const randomPart = randomString(length);
  return formatId(prefix, randomPart);
}
