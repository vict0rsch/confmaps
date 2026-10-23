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
