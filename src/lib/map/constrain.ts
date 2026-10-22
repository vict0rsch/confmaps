// Camera constraint for phones (pure; unit-tested). MapLibre's default keeps the world at least as
// tall as the viewport, which on a portrait phone means ~180° of longitude at most: the Americas or
// Asia get cropped. This one lets the world be smaller than the viewport (so a fit can show every
// pin) and then pins its top edge to the top of the visible area; the empty band left at the
// bottom shows the land colour, which reads as a continuation of Antarctica.

const MAX_LAT = 85.051129;
const mercY = (lat: number) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90;

/**
 * The centre latitude to use at `zoom` for a visible area `height` px tall (512 px tiles): the
 * world fills it vertically when tall enough, else its top edge sits at the area's top.
 */
export function constrainLat(lat: number, zoom: number, height: number): number {
  const world = 512 * 2 ** zoom;
  const half = height / 2 / world;
  const y = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  if (half >= 0.5) return latOf(half);
  return latOf(Math.min(1 - half, Math.max(half, mercY(y))));
}
