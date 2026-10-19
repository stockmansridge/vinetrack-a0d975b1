import { validateExactManifest, type ExactManifest } from './satellite-ingestion-core.ts';
// Catalogue normalization only. No loose Process/Stats mosaic is supported.
export function exactEarthSearchItem(item: {
  id: string; collection: string; properties: Record<string, unknown>;
  assets: Record<string, { href: string; 'raster:bands'?: { scale?: number; offset?: number; spatial_resolution?: number }[] }>;
}): ExactManifest {
  const baseline = item.properties['s2:processing_baseline'];
  if (typeof baseline !== 'string' || typeof item.properties.datetime !== 'string') throw new Error('Missing baseline/time');
  const bands: ExactManifest['bands'] = {};
  for (const key of ['red', 'green', 'blue', 'nir', 'scl']) {
    const asset = item.assets[key]; const raster = asset?.['raster:bands']?.[0];
    // Even baseline <04.00 must have explicit calibration; never assume offsets.
    if (!asset || !raster || raster.scale == null || raster.offset == null || raster.spatial_resolution == null) throw new Error('Missing explicit band calibration');
    bands[key] = { href: asset.href, item_id: item.id, scale: raster.scale, offset: raster.offset, resolution: raster.spatial_resolution };
  }
  const manifest: ExactManifest = { schema_version: 1, item_id: item.id, collection: item.collection,
    acquired_at: item.properties.datetime, baseline, cloud_mask_method: 'SCL', bands };
  validateExactManifest(manifest, 'NDVI'); validateExactManifest(manifest, 'TRUE_COLOUR'); return manifest;
}
export function requireAlignedScl(native: { crs: string; affine: number[] }, scl: { crs: string; affine: number[] }) {
  if (native.crs !== scl.crs || scl.affine[0] !== 20 || scl.affine[4] !== -20 || scl.affine[1] !== 0 || scl.affine[3] !== 0
    || (native.affine[2] - scl.affine[2]) % 10 !== 0 || (native.affine[5] - scl.affine[5]) % 10 !== 0) throw new Error('Unaligned native SCL grid');
}
export function sampleSclNearest(x: number, y: number, scl: { affine: number[]; width: number; height: number; values: number[] }) {
  const col = Math.floor((x - scl.affine[2]) / 20), row = Math.floor((scl.affine[5] - y) / 20);
  return col < 0 || row < 0 || col >= scl.width || row >= scl.height ? 0 : scl.values[row * scl.width + col];
}