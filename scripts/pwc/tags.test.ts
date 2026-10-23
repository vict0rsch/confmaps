import { describe, expect, it } from 'vitest';
import { subToTags } from './tags';

describe('subToTags', () => {
  it('maps every PwC code, deduplicated, in order', () => {
    expect(subToTags(['ML', 'CV', 'NLP', 'RO', 'SP', 'DM', 'CG', 'GR', 'AP', 'KR', 'HCI'])).toEqual(
      {
        tags: [
          'machine-learning',
          'computer-vision',
          'natural-language-processing',
          'robotics',
          'speech',
          'signal-processing',
          'data-mining',
          'computer-graphics',
          'automated-planning',
          'knowledge-representation',
          'human-computer-interaction',
        ],
        errors: [],
      },
    );
  });
  it('rejects unknown codes', () => {
    expect(subToTags(['ML', 'Statistic'])).toEqual({
      tags: ['machine-learning'],
      errors: ['unknown sub code "Statistic"'],
    });
  });
  it('allows no code', () => expect(subToTags([])).toEqual({ tags: [], errors: [] }));
});
