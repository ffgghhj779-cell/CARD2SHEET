import sharp from "sharp";

/** EXIF auto-rotate, downscale huge photos, normalise contrast (shadows/glare) -> JPEG.
 *  Remaining 90/180° rotation and skew are handled by the vision prompt. */
export async function prepareImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .normalise()
    .sharpen()
    .jpeg({ quality: 94 })
    .toBuffer();
}
