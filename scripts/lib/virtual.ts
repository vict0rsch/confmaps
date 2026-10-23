// Zod-free so the app can import it without bundling the schemas (re-exported by schema.ts).

/** A virtual location (no pin, no city). Narrows a location union to its virtual member. */
export const isVirtual = <L extends { format?: string }>(
  l: L,
): l is Extract<L, { format: 'virtual' }> => l.format === 'virtual';
