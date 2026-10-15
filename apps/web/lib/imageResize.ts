// Shrinks a photo in the browser before it's uploaded: at most
// MAX_LONG_SIDE pixels on its long side, re-encoded as a high-quality JPEG.
// Every photo is re-encoded, even small ones, because drawing it to a canvas
// drops its EXIF metadata — including the GPS location phones embed, which
// would otherwise be public on a listing photo (see the Privacy Policy).
// A typical 4000px phone photo goes from 3-8MB to well under 1MB, still
// sharp enough to zoom in on corners and edges, so listing pages load fast
// and the 10MB-per-photo storage limit is almost never hit.
//
// Used by every photo upload path (lib/storage.ts's listing/evidence
// uploads and the phone QR upload page).

export const MAX_LONG_SIDE = 2500;
const JPEG_QUALITY = 0.88;

// Types we can upload without converting. Anything else the browser can
// decode (e.g. HEIC in Safari) is converted to JPEG.
const UPLOADABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export class UnsupportedImageError extends Error {
  constructor(fileName: string) {
    super(`"${fileName}" isn't a photo type we can use. Save it as a JPEG, PNG, or WebP and try again.`);
    this.name = "UnsupportedImageError";
  }
}

export async function prepareImageForUpload(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // "from-image" applies the EXIF rotation, so a sideways phone photo
    // comes out upright once the EXIF data is gone.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (UPLOADABLE_TYPES.includes(file.type)) return file; // can't decode here; let storage decide
    throw new UnsupportedImageError(file.name || "That file");
  }

  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_LONG_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // JPEG has no transparency — paint white behind a transparent PNG
    // instead of letting it turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;

    const baseName = (file.name || "photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
