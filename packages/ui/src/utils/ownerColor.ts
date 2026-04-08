/**
 * Deterministic color palette for GPU allocation owner segments.
 *
 * Uses DJB2 hashing on ownerKey to produce a stable color index,
 * ensuring the same owner always gets the same color across refreshes.
 */

// 16-color palette for occupied segments (person or user)
const OWNER_PALETTE = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#8b5cf6', // violet-500
  '#f97316', // orange-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#a855f7', // purple-500
  '#f59e0b', // amber-500
  '#6366f1', // indigo-500
  '#84cc16', // lime-500
  '#ef4444', // red-500
  '#22d3ee', // cyan-400
  '#e879f9', // fuchsia-400
  '#34d399', // emerald-400
  '#fb923c', // orange-400
];

// Fixed color for Free memory segments
export const FREE_COLOR = 'rgb(51, 65, 85)'; // slate-700

// Fixed caution color for Unknown segments
export const UNKNOWN_COLOR = '#ff4d4f';

// Fixed color for Unattributed usage
export const UNATTRIBUTED_COLOR = '#94a3b8'; // slate-400

/**
 * DJB2 hash function for deterministic palette selection.
 * Returns a non-negative integer derived from the input string.
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic color for a GPU allocation owner segment.
 *
 * - 'unknown' ownerKind → fixed caution color
 * - 'unattributed' ownerKey → fixed slate color
 * - otherwise → DJB2 hash of ownerKey mod 16 into palette
 */
export function getOwnerColor(ownerKey: string, ownerKind: string): string {
  if (ownerKey === 'unattributed') return UNATTRIBUTED_COLOR;
  if (ownerKind === 'unknown') return UNKNOWN_COLOR;
  return OWNER_PALETTE[djb2Hash(ownerKey) % OWNER_PALETTE.length];
}
