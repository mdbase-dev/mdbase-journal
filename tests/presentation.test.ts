import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
const css = readFileSync(new URL("../public/journal.css", import.meta.url), "utf8");
function luminance(hex: string): number {
  const values = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
}
for (const [theme, selector] of [["light", /:root\s*\{([^}]+)\}/], ["dark", /:root\[data-theme="dark"\]\s*\{([^}]+)\}/]] as const) {
  test(`${theme} supporting text meets normal-text contrast on page and settings panel`, () => {
    const block = css.match(selector)?.[1]; assert(block, "Theme declaration is present");
    const tokens = new Map([...block.matchAll(/--([a-z]+):(#\w+);/g)].map(match => [match[1]!, match[2]!]));
    for (const background of ["bg", "panel"]) {
      const foreground = tokens.get("muted"), surface = tokens.get(background);
      assert(foreground && surface, "Text and surface tokens are present");
      const [low, high] = [luminance(foreground), luminance(surface)].sort((a, b) => a - b);
      const ratio = (high! + .05) / (low! + .05);
      assert(ratio >= 4.5, `${theme}/${background} supporting text contrast ${ratio.toFixed(2)} is below 4.5`);
    }
  });
}
