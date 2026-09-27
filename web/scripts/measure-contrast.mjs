import { readFile, writeFile } from "node:fs/promises";
const measured = JSON.parse(
  await readFile("../docs/evidence/computed-colors.json", "utf8"),
);
const rgb = (s) =>
  s.startsWith("#")
    ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
    : s
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
const luminance = (s) =>
  rgb(s)
    .map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (fg, bg) => {
  let a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const pairs = [
  [
    "Body on page",
    measured.body.color,
    measured.rootBackground,
    4.5,
    "browser-computed; transparent body resolves to root",
  ],
  [
    "Secondary on page",
    measured.muted.color,
    measured.rootBackground,
    4.5,
    "browser-computed; transparent intro resolves to root",
  ],
  [
    "Body on form",
    measured.surface.color,
    measured.surface.background,
    4.5,
    "browser-computed",
  ],
  [
    "Observed primary action",
    measured.action.color,
    measured.action.background,
    4.5,
    "browser-computed",
  ],
  [
    "Primary default",
    "#fffefa",
    "#b83e21",
    4.5,
    "CSS token pair; opaque rendered action",
  ],
  [
    "Secondary on neutral surface",
    "#626659",
    "#edeae0",
    4.5,
    "CSS token pair; opaque rendered neutral surface",
  ],
  [
    "Error message",
    "#a32920",
    "#fbe9e5",
    4.5,
    "CSS token pair; opaque error state exercised",
  ],
  [
    "Control boundary on page",
    "#85897a",
    "#f6f4ed",
    3,
    "CSS token pair; visible input/button boundary",
  ],
  [
    "Control boundary on form",
    "#85897a",
    "#fffefa",
    3,
    "CSS token pair; visible input/button boundary",
  ],
  [
    "Focus on page",
    "#262a22",
    "#f6f4ed",
    3,
    "CSS token pair; focus screenshot",
  ],
  ["Focus on form", "#262a22", "#fffefa", 3, "CSS token pair"],
].map(([pair, foreground, background, threshold, evidence]) => ({
  pair,
  foreground,
  background,
  ratio: Number(ratio(foreground, background).toFixed(2)),
  threshold,
  evidence,
}));
if (pairs.some((p) => p.ratio < p.threshold))
  throw Error("Contrast pair below threshold");
await writeFile(
  "../docs/evidence/contrast.json",
  JSON.stringify({ method: "WCAG sRGB relative luminance", pairs }, null, 2) +
    "\n",
);
console.log(pairs);
