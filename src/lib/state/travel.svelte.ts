// Global travel settings (DESIGN §4.2, §5.6): display units, travel mode and the `auto`
// rail/flight threshold. Read by filters through `Ctx`; persisted to localStorage and the URL.
//
// API for the settings UI: `travel.units / .mode / .threshold` (reactive), and the setters
// `setUnits`, `setMode`, `setThreshold` (validate, then persist). `apply()` is for values that
// arrive in a shared link: used for this visit, not persisted.
import { safeStorage } from './storage';
import { DEFAULT_THRESHOLD_KM, type ModeSetting } from '../co2/model';
import type { Units } from '../filters/types';

export type TravelValues = { units: Units; mode: ModeSetting; threshold: number };

export const TRAVEL_STORAGE_KEY = 'confmaps:travel';
export const DEFAULT_TRAVEL: Readonly<TravelValues> = {
  units: 'km',
  mode: 'auto',
  threshold: DEFAULT_THRESHOLD_KM,
};
/** Upper bound for the threshold: half the Earth's circumference (rail everywhere). */
export const THRESHOLD_MAX_KM = 20040;

export const isUnits = (v: unknown): v is Units => v === 'km' || v === 'mi';
export const isMode = (v: unknown): v is ModeSetting => v === 'auto' || v === 'fly';
export const isThreshold = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= THRESHOLD_MAX_KM;

/** Keep only valid fields of an untrusted object. */
export function validTravel(v: unknown): Partial<TravelValues> {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: Partial<TravelValues> = {};
  if (isUnits(o.units)) out.units = o.units;
  if (isMode(o.mode)) out.mode = o.mode;
  if (isThreshold(o.threshold)) out.threshold = o.threshold;
  return out;
}

export function readTravel(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): TravelValues {
  try {
    const raw = storage?.getItem(TRAVEL_STORAGE_KEY);
    return { ...DEFAULT_TRAVEL, ...(raw ? validTravel(JSON.parse(raw)) : {}) };
  } catch {
    return { ...DEFAULT_TRAVEL };
  }
}

export function writeTravel(
  v: TravelValues,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(TRAVEL_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // The app works without persistence.
  }
}

export class TravelSettings {
  readonly #storage: Storage | undefined;

  units: Units = $state(DEFAULT_TRAVEL.units);
  mode: ModeSetting = $state(DEFAULT_TRAVEL.mode);
  /** km. */
  threshold: number = $state(DEFAULT_TRAVEL.threshold);
  /** The values in use came from a shared link (this visit only). */
  fromLink = $state(false);

  constructor(storage: Storage | undefined = safeStorage()) {
    this.#storage = storage;
    this.apply(readTravel(storage));
  }

  get values(): TravelValues {
    return { units: this.units, mode: this.mode, threshold: this.threshold };
  }

  setUnits(units: Units): void {
    if (isUnits(units)) this.#persist({ units });
  }

  setMode(mode: ModeSetting): void {
    if (isMode(mode)) this.#persist({ mode });
  }

  /** km, rounded to an integer; ignored unless finite and in `0..THRESHOLD_MAX_KM`. */
  setThreshold(km: number): void {
    const v = Math.round(km);
    if (isThreshold(v)) this.#persist({ threshold: v });
  }

  /** Use these (validated) values for this visit without persisting them. */
  apply(v: Partial<TravelValues>): void {
    const ok = validTravel(v);
    if (ok.units) this.units = ok.units;
    if (ok.mode) this.mode = ok.mode;
    if (ok.threshold !== undefined) this.threshold = ok.threshold;
  }

  /** Travel values from a shared link: used for this visit, not saved, and flagged for a notice.
   *  A link that only repeats the values in use (the viewer's own, synced to the URL) is not shared. */
  applyShared(v: Partial<TravelValues>): void {
    const ok = validTravel(v);
    const current = this.values;
    if (!(Object.keys(ok) as (keyof TravelValues)[]).some((k) => ok[k] !== current[k])) return;
    this.apply(ok);
    this.fromLink = true;
  }

  /** Leave the shared-link view: back to the saved settings (or defaults). */
  useMine(): void {
    this.apply(readTravel(this.#storage));
    this.fromLink = false;
  }

  #persist(v: Partial<TravelValues>): void {
    this.fromLink = false;
    this.apply(v);
    writeTravel(this.values, this.#storage);
  }
}

export const travel = new TravelSettings();
