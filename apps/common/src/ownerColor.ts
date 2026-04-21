/**
 * Deterministic, collision-aware color palette for GPU allocation owner segments.
 *
 * Algorithm:
 *   1. Try the DJB2-hash-derived palette slot for the owner key.
 *   2. If that color is already in `usedColors`, fall back to the palette
 *      entry with the greatest minimum hue-distance from all used colors
 *      (maximin strategy).
 *   3. If the entire palette is exhausted, accept the hash color (collision).
 *
 * Callers that want collision-free assignment should:
 *   - Sort owner keys alphabetically before iterating.
 *   - Maintain a `usedColors` Set and pass it on each call, adding the
 *     returned color to the set after each assignment.
 */

// 24-color palette for occupied owner segments.
//
// First 12 (indices 0-11): original well-distributed hues.
//   These are the sole targets of a pure-hash assignment (mod 12 fallback),
//   so backward-compatible color stability is preserved for common cases.
//
// Extended 12 (indices 12-23): fill remaining hue gaps and provide overflow
//   capacity. Reached by hash for some keys; selected by the maximin
//   algorithm when the primary hue is already taken.
const OWNER_PALETTE: string[] = [
  '#3b82f6', // blue-500       ~217°
  '#10b981', // emerald-500    ~160°
  '#8b5cf6', // violet-500     ~263°
  '#f97316', // orange-500     ~25°
  '#06b6d4', // cyan-500       ~192°
  '#ec4899', // pink-500       ~330°
  '#14b8a6', // teal-500       ~174°
  '#a855f7', // purple-500     ~271°
  '#f59e0b', // amber-500      ~38°
  '#6366f1', // indigo-500     ~239°
  '#84cc16', // lime-500       ~83°
  '#ef4444', // red-500        ~0°
  '#f43f5e', // rose-500       ~351°  gap: pink → red
  '#eab308', // yellow-500     ~48°   gap: amber → lime
  '#22c55e', // green-500      ~142°  gap: lime → emerald
  '#e879f9', // fuchsia-400    ~292°  gap: purple → pink
  '#0ea5e9', // sky-500        ~199°  gap: cyan → blue
  '#d946ef', // fuchsia-500    ~293°  overflow: second fuchsia
  '#4ade80', // green-400      ~142°  overflow: lighter green
  '#60a5fa', // blue-400       ~217°  overflow: lighter blue
  '#c084fc', // purple-400     ~271°  overflow: lighter purple
  '#fb923c', // orange-400     ~25°   overflow: lighter orange
  '#38bdf8', // sky-400        ~199°  overflow: lighter sky
  '#a3e635', // lime-400       ~83°   overflow: brighter lime
];

/** Fixed color for Free memory segments (unified hex form, same value as slate-700). */
export const FREE_COLOR = '#334155';

/** Fixed caution color for Unknown process segments. */
export const UNKNOWN_COLOR = '#ff4d4f';

/** Fixed neutral color for Unattributed usage segments. */
export const UNATTRIBUTED_COLOR = '#94a3b8'; // slate-400

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Convert a 6-digit hex color string ('#rrggbb') to its HSL hue (0–360°).
 * Returns 0 for achromatic colors.
 */
function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) {
    h = ((g - b) / delta + 6) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  return h * 60;
}

/** Circular hue distance in degrees (0–180). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a color for a GPU allocation owner segment.
 *
 * @param ownerKey   - Unique owner identifier, e.g. `"user:alice"`.
 * @param ownerKind  - Semantic kind: `"user"`, `"unknown"`, `"unattributed"`,
 *                     or internal fallback keys such as `"managed"`.
 * @param usedColors - Optional set of colors already assigned to other owners
 *                     in the same render context. When provided, the function
 *                     avoids returning a color that is already in the set by
 *                     applying the maximin hue-distance strategy.
 *
 * Stability contract: for a given `ownerKey`, the result is the same hash
 * color as long as that color is not present in `usedColors`. Callers can
 * preserve per-owner color stability by processing owners in a deterministic
 * order (e.g. sorted by ownerKey) so that each owner "claims" its preferred
 * hash slot before any other owner can conflict with it.
 */
export function getOwnerColor(ownerKey: string, ownerKind: string, usedColors?: Set<string>): string {
  if (ownerKey === 'unattributed') return UNATTRIBUTED_COLOR;
  if (ownerKind === 'unknown') return UNKNOWN_COLOR;

  const hashColor = OWNER_PALETTE[djb2Hash(ownerKey) % OWNER_PALETTE.length];

  // No usedColors provided, or hash color is still free → return it directly.
  if (!usedColors || usedColors.size === 0 || !usedColors.has(hashColor)) {
    return hashColor;
  }

  // Maximin fallback: pick the palette color with the greatest minimum
  // hue-distance from all already-used colors.
  const usedHues = [...usedColors].map(hexToHue);
  let bestColor = hashColor; // accepted collision if everything is taken
  let bestMinDist = -1;

  for (const candidate of OWNER_PALETTE) {
    if (usedColors.has(candidate)) continue;
    const candidateHue = hexToHue(candidate);
    const minDist = Math.min(...usedHues.map((h) => hueDistance(candidateHue, h)));
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestColor = candidate;
    }
  }

  return bestColor;
}
