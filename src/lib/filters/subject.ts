// `subject`: conference tags, grouped into human subjects. Conference-level; a conference matches
// if any of its tags falls in any selected subject (OR within the filter, like the HF site).
//
// Upstream tags (huggingface/ai-deadlines) are free-form kebab-case slugs, with a few spaced or
// singular variants ("machine learning", "image processing"). The HF site labels each tag by
// title-casing it ("computer-vision" → "Computer Vision"); here near-duplicates are merged under
// one subject with a short URL code (`sub=ML,CV`). Tags not listed below still work: they become
// their own subject (HF-style label, slug code) in the "Other" group.
import SubjectControl from '../../components/filters/SubjectControl.svelte';
import type { Conference } from '../data/types';
import { param, readParam, type Filter } from './types';

export type SubjectGroup = 'Machine learning' | 'Perception & language' | 'Applications' | 'Other';
export const SUBJECT_GROUPS: readonly SubjectGroup[] = [
  'Machine learning',
  'Perception & language',
  'Applications',
  'Other',
];

export type Subject = { code: string; label: string; group: SubjectGroup; tags: string[] };

/** Known subjects, in display order. Tags are normalized (see `normalizeTag`). */
export const SUBJECTS: readonly Subject[] = [
  {
    code: 'ML',
    label: 'Machine learning',
    group: 'Machine learning',
    tags: ['machine-learning', 'deep-learning', 'lifelong-learning', 'pattern-recognition'],
  },
  {
    code: 'RL',
    label: 'Reinforcement learning',
    group: 'Machine learning',
    tags: ['reinforcement-learning'],
  },
  {
    code: 'REPR',
    label: 'Representation learning',
    group: 'Machine learning',
    tags: ['representation-learning'],
  },
  {
    code: 'LLM',
    label: 'Large language models',
    group: 'Machine learning',
    tags: ['large-language-models'],
  },
  {
    code: 'OPT',
    label: 'Optimization & mathematics',
    group: 'Machine learning',
    tags: ['optimization-methods', 'mathematics'],
  },
  {
    code: 'KR',
    label: 'Knowledge & reasoning',
    group: 'Machine learning',
    tags: [
      'reasoning',
      'knowledge-representation',
      'knowledge-graphs',
      'semantics-and-knowledge',
      'automated-planning',
    ],
  },
  { code: 'FAIR', label: 'Fairness', group: 'Machine learning', tags: ['fairness'] },
  {
    code: 'CV',
    label: 'Computer vision',
    group: 'Perception & language',
    tags: ['computer-vision', 'image-processing', 'visual-information-processing'],
  },
  {
    code: 'NLP',
    label: 'Natural language processing',
    group: 'Perception & language',
    tags: ['natural-language-processing'],
  },
  {
    code: 'SP',
    label: 'Speech & signal processing',
    group: 'Perception & language',
    tags: ['speech', 'signal-processing'],
  },
  {
    code: 'CG',
    label: 'Computer graphics',
    group: 'Perception & language',
    tags: ['computer-graphics'],
  },
  { code: 'RO', label: 'Robotics', group: 'Applications', tags: ['robotics'] },
  {
    code: 'DM',
    label: 'Data mining',
    group: 'Applications',
    tags: ['data-mining', 'web-mining', 'content-analysis'],
  },
  {
    code: 'IR',
    label: 'Search & recommendation',
    group: 'Applications',
    tags: [
      'web-search',
      'retrieval',
      'information-retrieval',
      'recommendation',
      'information-systems',
    ],
  },
  {
    code: 'HCI',
    label: 'Human-computer interaction',
    group: 'Applications',
    tags: ['human-computer-interaction'],
  },
  {
    code: 'SE',
    label: 'Software engineering',
    group: 'Applications',
    tags: ['software-engineering'],
  },
];

const byCode = new Map(SUBJECTS.map((s) => [s.code, s]));
const byTag = new Map(SUBJECTS.flatMap((s) => s.tags.map((t) => [t, s] as const)));

/** "Machine learning" / "machine_learning" → "machine-learning". */
export const normalizeTag = (tag: string) =>
  tag
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/** The subject a tag belongs to; unknown tags become their own "Other" subject. */
export function subjectOfTag(tag: string): Subject {
  const t = normalizeTag(tag);
  const known = byTag.get(t);
  if (known) return known;
  const label = t
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return { code: t, label, group: 'Other', tags: [t] };
}

/** Subject codes of a conference. */
export const conferenceSubjects = (c: Pick<Conference, 'tags'>): Set<string> =>
  new Set(c.tags.map((t) => subjectOfTag(t).code).filter(Boolean));

/** Subjects present in `conferences`, in display order, with conference counts. */
export function subjectCatalog(
  conferences: readonly Pick<Conference, 'tags'>[],
): (Subject & { count: number })[] {
  const counts = new Map<string, number>();
  const found = new Map<string, Subject>();
  for (const c of conferences) {
    for (const code of conferenceSubjects(c)) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
      if (!found.has(code)) found.set(code, byCode.get(code) ?? subjectOfTag(code));
    }
  }
  const order = (s: Subject) => {
    const i = SUBJECTS.indexOf(s);
    return i < 0 ? SUBJECTS.length : i;
  };
  return [...found.values()]
    .sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label))
    .map((s) => ({ ...s, count: counts.get(s.code) ?? 0 }));
}

/** Canonical code for a URL token: a known code (any case), else a tag slug mapped to its subject. */
function parseCode(token: string): string | undefined {
  const upper = token.trim().toUpperCase();
  if (byCode.has(upper)) return upper;
  const slug = token.trim();
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 60
    ? subjectOfTag(slug).code
    : undefined;
}

/** Selected subject codes, sorted and unique (so equal selections compare equal). */
export type SubjectState = string[];

export const normalizeCodes = (codes: Iterable<string>): SubjectState => [...new Set(codes)].sort();

export const subjectFilter: Filter<SubjectState> = {
  id: 'subject',
  label: 'Topics',
  defaultState: [],
  isActive: (s) => s.length > 0,
  test: (loc, _ctx, s) => {
    const mine = conferenceSubjects(loc.conference);
    return s.some((code) => mine.has(code));
  },
  Control: SubjectControl,
  params: ['sub'],
  toURL: (s) => param('sub', s.join(',')),
  fromURL: (v) => {
    const raw = readParam(v, 'sub');
    if (!raw) return [];
    return normalizeCodes(
      raw
        .split(',')
        .slice(0, 50)
        .map(parseCode)
        .filter((c): c is string => !!c),
    );
  },
};
