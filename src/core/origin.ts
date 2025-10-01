import { getOrigin, setOrigin } from "./store";

/** Require protocol + host, no path, no trailing slash. */
export function setActiveOrigin(input: string) {
  const u = new URL(input);
  if (u.pathname !== "/" || u.search || u.hash) {
    throw new Error(
      `[intercept.origin] Expected an origin without path/query/hash, e.g. "https://api.example.com". Got: "${input}"`,
    );
  }
  const normalized = `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}`;
  // Disallow trailing slash beyond the normalized form (which ends without one)
  if (normalized.endsWith("//")) {
    throw new Error(`[intercept.origin] Invalid origin: "${input}"`);
  }
  setOrigin(normalized);
}

export function getActiveOrigin(): string | null {
  return getOrigin();
}

export function resetActiveOrigin() {
  setOrigin(null);
}
