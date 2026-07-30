export interface CompressOptions {
  /** Bounding-box width the image is scaled to fit (px). */
  maxWidth?: number;
  /** Bounding-box height the image is scaled to fit (px). */
  maxHeight?: number;
  /** Encoder quality, 0–1. */
  quality?: number;
  /** Output MIME type. */
  type?: string;
}

/**
 * Downscale an image onto a `<canvas>` and re-encode it to a compressed Blob
 * (WebP by default). Aspect ratio is preserved and the image is never upscaled.
 * The returned Blob is stored directly in IndexedDB — no base64 round-trip
 * (structured clone handles Blobs natively).
 */
export async function compressImage(file: Blob, options: CompressOptions = {}): Promise<Blob> {
  const { maxWidth = 512, maxHeight = 512, quality = 0.8, type = 'image/webp' } = options;

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context is unavailable');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) {
      throw new Error('Canvas failed to encode the image');
    }
    return blob;
  } finally {
    bitmap.close();
  }
}
