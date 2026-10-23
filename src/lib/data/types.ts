// Types of data/build/data.json, inferred from the pipeline's Zod schemas (scripts/schema.ts).
export type {
  Conference,
  DataFile,
  Deadline,
  EventLocation,
  PinnedLocation,
  VirtualLocation,
} from '../../../scripts/schema';
export { isVirtual } from '../../../scripts/lib/virtual';
