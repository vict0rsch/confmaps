// PwC `sub` codes (its `_data/types.yml`) → HF-style tag slugs.

export const SUB_TAGS: Record<string, readonly string[]> = {
  ML: ['machine-learning'],
  CV: ['computer-vision'],
  NLP: ['natural-language-processing'],
  RO: ['robotics'],
  SP: ['speech', 'signal-processing'],
  DM: ['data-mining'],
  CG: ['computer-graphics'],
  GR: ['computer-graphics'], // siggraph17
  AP: ['automated-planning'],
  KR: ['knowledge-representation'],
  HCI: ['human-computer-interaction'],
};

/** Tags for `sub` codes, deduplicated in order; an unknown code is an error. */
export function subToTags(sub: readonly string[]): { tags: string[]; errors: string[] } {
  const tags: string[] = [];
  const errors: string[] = [];
  for (const code of sub) {
    const mapped = SUB_TAGS[code];
    if (!mapped) errors.push(`unknown sub code "${code}"`);
    else for (const t of mapped) if (!tags.includes(t)) tags.push(t);
  }
  return { tags, errors };
}
