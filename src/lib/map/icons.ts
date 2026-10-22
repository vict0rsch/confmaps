// Raster icons generated on the client (no sprite request), added via `styleimagemissing`.

const PIXEL_RATIO = 2;
const SIZE = 14; // css px

/** Lock badge for authors-only sites: a disc in `fill` with a padlock in `ink`. */
export function lockBadge(fill: string, ink: string, halo: string) {
  const px = SIZE * PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  const c = SIZE / 2;

  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c, c, c - 1.25, 0, Math.PI * 2);
  ctx.fill();

  // Padlock: shackle + body, ~7 px wide.
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(c, c - 1, 2, Math.PI, 0);
  ctx.lineTo(c + 2, c + 0.5);
  ctx.moveTo(c - 2, c - 1);
  ctx.lineTo(c - 2, c + 0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(c - 3.25, c - 0.25, 6.5, 4.75, 1);
  ctx.fill();

  return {
    image: ctx.getImageData(0, 0, px, px),
    options: { pixelRatio: PIXEL_RATIO },
  };
}
