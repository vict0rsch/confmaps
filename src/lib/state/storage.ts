/** `localStorage`, or `undefined` when unavailable: the getter itself can throw (blocked site data). */
export function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}
