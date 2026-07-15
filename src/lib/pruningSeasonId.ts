// Deterministic pruning-season UUID (v3-shaped) shared with iOS + Android.
// Byte-for-byte identical to Kotlin UUID.nameUUIDFromBytes /
// iOS PruningSeasonId.make. Never generate random season IDs — sync
// alignment across platforms depends on this deterministic derivation.
import md5 from "js-md5";

export function pruningSeasonId(
  vineyardId: string,
  paddockId: string,
  seasonYear: number,
): string {
  const name = `vinetrack-pruning-season|${vineyardId.toLowerCase()}|${paddockId.toLowerCase()}|${seasonYear}`;
  const bytes = new Uint8Array(md5.create().update(name).arrayBuffer());
  bytes[6] = (bytes[6] & 0x0f) | 0x30; // version 3
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // IETF variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
