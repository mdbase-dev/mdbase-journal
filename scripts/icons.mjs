import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Renders Journal's install icons from one row of the mdbase mark on its pixel grid (see
 * mdbase-connect's `scripts/write-brand-icons.mjs`).
 *
 * - `pwa-192.png`, `pwa-512.png`: the rounded light tile of the mdbase app icons on a
 *   transparent canvas, so docks and taskbars show a tile rather than a white square.
 *   The tile stays light because the highlighted line is ink.
 * - `pwa-maskable-512.png`: full bleed with the mark inside the 80% safe zone, for
 *   launchers that crop icons to their own shape.
 * - `apple-touch-icon.png`: full bleed and opaque; iOS rounds the corners itself and
 *   fills transparency with black.
 *
 * Needs `rsvg-convert` (librsvg). Run `node scripts/icons.mjs` after
 * changing the mark and commit the PNGs.
 */

const bars = "#00785a";
const line = "#131921";
const paper = "#fcfdff";
const edge = "#e2e7ed";
const background = "#fcfcfd";

/**
 * `[x, y, width]` on the 16-unit grid; every bar is 2 units tall. Journal uses one row of
 * the mdbase mark, its field and highlighted line, centred on the grid. Alone, the grid's
 * square field and one-unit gap look cramped, so the row keeps the original logo's
 * proportions (field 12 × 10, gap 8, line 56 in `mdbase-icon.svg`) at the family's bar
 * height. The hand-drawn 16px favicon stays on whole grid units to remain crisp.
 */
const BAR = 2;
const fieldWidth = (12 / 10) * BAR;
const gap = (8 / 10) * BAR;
const lineWidth = (56 / 10) * BAR;
const rowStart = 8 - (fieldWidth + gap + lineWidth) / 2;
const barRects = [[rowStart, 7, fieldWidth]];
const lineRect = [rowStart + fieldWidth + gap, 7, lineWidth];

const rect = ([x, y, width], fill) =>
  `<rect x="${x}" y="${y}" width="${width}" height="2" fill="${fill}"/>`;

/** The mark at `unit` pixels per grid unit, centred on a `size` canvas. */
function mark(size, unit) {
  const offset = (size - 14 * unit) / 2 - unit;
  return [
    `<g transform="translate(${offset} ${offset}) scale(${unit})">`,
    ...barRects.map((b) => `  ${rect(b, bars)}`),
    `  ${rect(lineRect, line)}`,
    "</g>",
  ];
}

function svg(size, body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    ...body.map((l) => `  ${l}`),
    "</svg>",
    "",
  ].join("\n");
}

/** The app-icon tile: rounded corners, a hairline edge, the mark across 55% of it. */
function tileIcon(size) {
  const k = size / 256;
  return svg(size, [
    `<rect width="${size}" height="${size}" rx="${48 * k}" fill="${paper}"/>`,
    `<rect x="${0.75 * k}" y="${0.75 * k}" width="${size - 1.5 * k}" height="${size - 1.5 * k}" rx="${47.25 * k}" fill="none" stroke="${edge}" stroke-width="${1.5 * k}"/>`,
    ...mark(size, 10 * k),
  ]);
}

/** A full-bleed square with the mark spanning `fraction` of it. */
function fullBleed(size, fraction) {
  return svg(size, [
    `<rect width="${size}" height="${size}" fill="${background}"/>`,
    ...mark(size, Math.round((size * fraction) / 14)),
  ]);
}

const icons = {
  "pwa-192.png": [192, tileIcon(192)],
  "pwa-512.png": [512, tileIcon(512)],
  // The mark's corners must stay inside the safe zone's circle (diameter 80%).
  "pwa-maskable-512.png": [512, fullBleed(512, 0.49)],
  "apple-touch-icon.png": [180, fullBleed(180, 0.55)],
};

const output = resolve(import.meta.dirname, "../public");
const work = await mkdtemp(join(tmpdir(), "pwa-icons-"));
try {
  for (const [name, [size, source]] of Object.entries(icons)) {
    const path = join(work, `${name}.svg`);
    await writeFile(path, source);
    execFileSync("rsvg-convert", [
      "--width",
      `${size}`,
      "--height",
      `${size}`,
      "--output",
      resolve(output, name),
      path,
    ]);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
