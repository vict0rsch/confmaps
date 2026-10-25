// Raster icons generated on the client (no sprite request), added via `styleimagemissing`.

const PIXEL_RATIO = 2;
const SIZE = 14; // css px

/**
 * Badge for authors-only sites: a small disc in `fill` with a `halo` ring, like the legend's dot
 * (no padlock glyph).
 */
export function lockBadge(fill: string, halo: string) {
  const px = SIZE * PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  const c = SIZE / 2;

  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(c, c, 4.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c, c, 3, 0, Math.PI * 2);
  ctx.fill();

  return {
    image: ctx.getImageData(0, 0, px, px),
    options: { pixelRatio: PIXEL_RATIO },
  };
}
