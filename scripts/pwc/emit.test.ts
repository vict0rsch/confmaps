import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PastConferencesFileSchema, type PastConference } from '../schema';
import { emitPastFile, HEADER } from './emit';

const virtual: PastConference = {
  id: 'sem21',
  title: '*SEM',
  year: 2021,
  link: 'https://example.org/starsem?a=1&b=2',
  start: '2021-08-05',
  end: '2021-08-06',
  format: 'virtual',
  tags: [],
  notes: 'Held online (nominal host: Bangkok, Thailand).',
  source: 'pwc',
  pwc: {
    ids: ['starsem21', 'cscw24_january'],
    first_sha: '1234567890123456789012345678901234567890',
    first_date: '2020-01-02',
    last_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    last_date: '2021-09-01',
    fixes: ['title: <span>*</span>SEM → *SEM', "place: 'x' → y"],
  },
};
const hybrid: PastConference = {
  id: 'neurips22',
  title: 'NeurIPS',
  year: 2022,
  full_name: 'Conference on Neural Information Processing Systems: 36th',
  link: 'https://neurips.cc/Conferences/2022/',
  start: '2022-11-28',
  end: '2022-12-09',
  format: 'hybrid',
  city: 'New Orleans',
  country: 'United States',
  venue: 'Ernest N. Morial Convention Center',
  tags: ['machine-learning', 'computer-vision'],
  source: 'pwc',
  pwc: {
    ids: ['neurips22'],
    first_sha: 'a'.repeat(40),
    first_date: '2022-03-03',
    last_sha: 'b'.repeat(40),
    last_date: '2024-09-15',
  },
};

describe('emitPastFile', () => {
  const text = emitPastFile([virtual, hybrid], new Map([['sem21', ['multi-id', 'fixes-applied']]]));

  it('round-trips and validates', () => {
    const doc = parse(text);
    expect(doc).toEqual([virtual, hybrid]);
    expect(PastConferencesFileSchema.safeParse(doc).success).toBe(true);
  });

  it('writes the spec key order, quoted dates and SHAs, and the review comment', () => {
    expect(text.slice(HEADER.length)).toBe(`
- id: sem21 # review: multi-id, fixes-applied
  title: '*SEM'
  year: 2021
  link: https://example.org/starsem?a=1&b=2
  start: '2021-08-05'
  end: '2021-08-06'
  format: virtual
  tags: []
  notes: 'Held online (nominal host: Bangkok, Thailand).'
  source: pwc
  pwc:
    ids: [starsem21, cscw24_january]
    first_sha: '1234567890123456789012345678901234567890'
    first_date: '2020-01-02'
    last_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
    last_date: '2021-09-01'
    fixes:
      - 'title: <span>*</span>SEM → *SEM'
      - "place: 'x' → y"

- id: neurips22
  title: NeurIPS
  year: 2022
  full_name: 'Conference on Neural Information Processing Systems: 36th'
  link: https://neurips.cc/Conferences/2022/
  start: '2022-11-28'
  end: '2022-12-09'
  format: hybrid
  city: New Orleans
  country: United States
  venue: Ernest N. Morial Convention Center
  tags: [machine-learning, computer-vision]
  source: pwc
  pwc:
    ids: [neurips22]
    first_sha: '${'a'.repeat(40)}'
    first_date: '2022-03-03'
    last_sha: '${'b'.repeat(40)}'
    last_date: '2024-09-15'
`);
  });

  it('never puts the review marker in the header', () => {
    expect(HEADER).not.toMatch(/#\s*review:/i);
    expect(emitPastFile([virtual, hybrid])).not.toMatch(/#\s*review:/i);
  });

  it('writes an empty list', () => expect(parse(emitPastFile([]))).toEqual([]));

  it('rejects unknown keys', () => {
    expect(() => emitPastFile([{ ...hybrid, extra: 1 } as PastConference])).toThrow(/extra/);
  });
});
