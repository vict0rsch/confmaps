import type { EventLocation, PinnedLocation } from '../data/types';

export type Access = EventLocation['access'];

export const ACCESS_LABEL: Record<Access, string> = {
  open: 'Open to all',
  registration: 'Registration',
  authors_only: 'Authors only',
};

export const ACCESS_ICON = { open: 'open', registration: 'ticket', authors_only: 'lock' } as const;

export const roleLabel = (l: Pick<EventLocation, 'role'>) =>
  l.role === 'main' ? 'Main venue' : 'Satellite';

export const kindLabel = (l: Pick<EventLocation, 'official'>) =>
  l.official ? 'Official' : 'Community';

/** "Paris, France". */
export const placeLabel = (l: Pick<PinnedLocation, 'city' | 'country'>) =>
  `${l.city}, ${l.country}`;
