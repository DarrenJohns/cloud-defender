import { seededRandom } from "./textures";

export const CLOUD_COUNT = 5;
const CLOUD_HEIGHTS = [0.3, 0.66, 0.2, 0.55, 0.34];

export function createCloudWidths(seed: number): number[] {
  const random = seededRandom(seed);
  const widths = Array.from({ length: CLOUD_COUNT }, (_, index) => 0.12 + index * 0.035 + random() * 0.025);
  for (let index = widths.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [widths[index], widths[other]] = [widths[other]!, widths[index]!];
  }
  return widths;
}

const DEFAULT_WIDTHS = createCloudWidths(0xc10d);

/** Viewport-relative slots share their drift, so their horizontal separation never closes. */
export function cloudLayout(seconds: number, widths: readonly number[] = DEFAULT_WIDTHS) {
  const drift = Math.sin(seconds * 0.16) * 0.055;
  return CLOUD_HEIGHTS.map((height, index) => ({
    x: -0.7 + index * 0.35 + drift,
    y: height + Math.sin(seconds * 0.14 + index * 2.1) * 0.035,
    width: widths[index]!,
  }));
}
