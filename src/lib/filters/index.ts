// The filter registry, in display order. Adding a filter = adding a file (logic + its Control)
// and one line here; the panel, predicate, URL state and badge pick it up.
import { accessFilter } from './access';
import { co2Filter } from './co2';
import { createDatesFilter } from './dates';
import { kindFilter } from './kind';
import { openFilter } from './open';
import { radiusFilter } from './radius';
import { searchFilter } from './search';
import { subjectFilter } from './subject';
import type { AnyFilter } from './types';

/** `today` (`YYYY-MM-DD`) sets the `dates` default (the Plan window). */
export function createFilters(today: string): AnyFilter[] {
  return [
    searchFilter,
    createDatesFilter(today),
    subjectFilter,
    radiusFilter,
    co2Filter,
    openFilter,
    accessFilter,
    kindFilter,
  ];
}

export type { AnyFilter, ControlProps, Ctx, Filter, Units } from './types';
