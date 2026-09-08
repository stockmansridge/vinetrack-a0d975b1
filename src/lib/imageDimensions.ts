// Intrinsic pixel size read from raw image bytes.
//
// PDF exports must preserve a logo's aspect ratio, and the export runs where
// decoding an <img> is not always possible (tests, workers, offline). Reading
// the header bytes is deterministic and needs no DOM.

export interface PixelSize {
  width: number;
  height: number;
}

function pngSize(b: Uint8Array): PixelSize | null {
  if (b.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return null;
  const read = (o: number) =>
    ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const width = read(16);
  const height = read(20);
  return width && height ? { width, height } : null;
}

function gifSize(b: Uint8Array): PixelSize | null {
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  return width && height ? { width, height } : null;
}

function jpegSize(b: Uint8Array): PixelSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width && height ? { width, height } : null;
    }
    if (len <= 0) return null;
    i += 2 + len;
  }
  return null;
}

/** Intrinsic size of PNG, JPEG or GIF bytes; null when it cannot be read. */
export function imageSizeFromBytes(bytes: Uint8Array): PixelSize | null {
  return pngSize(bytes) ?? jpegSize(bytes) ?? gifSize(bytes);
}

/** Decode a base64 data URL to bytes. Returns an empty array when malformed. */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return new Uint8Array();
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

/** jsPDF image format token for a data URL. */
export function dataUrlImageFormat(dataUrl: string): "PNG" | "JPEG" | "GIF" {
  if (/^data:image\/jpe?g/i.test(dataUrl)) return "JPEG";
  if (/^data:image\/gif/i.test(dataUrl)) return "GIF";
  return "PNG";
}

/**
 * Fit a picture inside a box without distortion or clipping.
 * Falls back to the box itself when the intrinsic size is unknown.
 */
export function fitWithin(
  size: PixelSize | null,
  boxWidth: number,
  boxHeight: number,
): PixelSize {
  if (!size || !size.width || !size.height) {
    return { width: Math.min(boxWidth, boxHeight), height: Math.min(boxWidth, boxHeight) };
  }
  const scale = Math.min(boxWidth / size.width, boxHeight / size.height);
  return { width: size.width * scale, height: size.height * scale };
}
