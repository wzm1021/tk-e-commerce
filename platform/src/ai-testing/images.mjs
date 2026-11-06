import sharp from "sharp";
import { requireThat } from "../common/core.mjs";
export async function inspectImage(bytes) {
  requireThat(
    bytes.length > 0 && bytes.length <= 5 * 1024 * 1024,
    "ai_image_size",
  );
  let info;
  try {
    info = await sharp(bytes, {
      limitInputPixels: 80_000_000,
      animated: true,
    }).metadata();
  } catch {
    requireThat(false, "ai_image_invalid");
  }
  const caps = {
    jpeg: 80_000_000,
    png: info.hasAlpha ? 25_000_000 : 45_000_000,
    webp: 12_000_000,
  };
  requireThat(
    caps[info.format] &&
      info.width > 0 &&
      info.height > 0 &&
      info.width * info.height <= caps[info.format] &&
      (info.pages || 1) === 1,
    "ai_image_invalid",
  );
  try {
    await sharp(bytes, {
      limitInputPixels: 80_000_000,
      failOn: "warning",
    }).stats();
  } catch {
    requireThat(false, "ai_image_invalid");
  }
  return {
    width: info.width,
    height: info.height,
    mime: "image/" + info.format,
    format: info.format,
  };
}
export async function cropImage(bytes, rect) {
  await inspectImage(bytes);
  try {
    return await sharp(bytes).extract(rect).jpeg({ quality: 90 }).toBuffer();
  } catch {
    requireThat(false, "ai_crop_invalid");
  }
}
