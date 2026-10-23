import { isVirtual, type EventLocation, type PinnedLocation } from '../data/types';

export type Access = EventLocation['access'];

export const ACCESS_LABEL: Record<Access, string> = {
  open: 'Open to all',
  registration: 'Registration',
  authors_only: 'Authors only',
};

export const ACCESS_ICON = { open: 'open', registration: 'ticket', authors_only: 'lock' } as const;

export const roleLabel = (l: Pick<EventLocation, 'role' | 'format'>) =>
  l.format === 'virtual' ? 'Virtual event' : l.role === 'main' ? 'Main venue' : 'Satellite';

export const kindLabel = (l: Pick<EventLocation, 'official'>) =>
  l.official ? 'Official' : 'Community';

export type Format = 'virtual' | 'hybrid';
export const FORMAT_LABEL: Record<Format, string> = { virtual: 'Virtual', hybrid: 'Hybrid' };

/** "Paris, France"; "Online" for a virtual edition. */
export const placeLabel = (
  l: Pick<PinnedLocation, 'city' | 'country' | 'format'> | { format: 'virtual' },
) => (isVirtual(l) ? 'Online' : `${l.city}, ${l.country}`);

const WAYBACK = /^https?:\/\/web\.archive\.org\/web\/[^/]+\/(.+)$/;
const bareHost = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/**
 * How a conference website link reads: its hostname ("icml.cc"), or "Archived site" plus the
 * original hostname for a Wayback Machine snapshot (how past editions link to their site).
 */
export function websiteLabel(link: string): { text: string; archivedHost?: string } {
  const original = WAYBACK.exec(link)?.[1];
  try {
    if (original) return { text: 'Archived site', archivedHost: bareHost(original) };
    return { text: bareHost(link) };
  } catch {
    return { text: original ? 'Archived site' : link };
  }
}
