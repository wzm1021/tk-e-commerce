import path from "node:path";
import sharp from "sharp";
import { inflateRawSync } from "node:zlib";
import { requireThat } from "../common/core.mjs";
import { FILE_LIMIT } from "./contract.mjs";

const office = {
  docx: [
    "word/document.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  xlsx: [
    "xl/workbook.xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
};
function officeFile(bytes, ext) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  requireThat(end >= 0, "feedback_file_invalid");
  const count = bytes.readUInt16LE(end + 10),
    start = bytes.readUInt32LE(end + 16),
    size = bytes.readUInt32LE(end + 12);
  requireThat(
    count > 0 &&
      count <= 2000 &&
      start + size === end &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length &&
      bytes.readUInt16LE(end + 8) === count &&
      bytes.readUInt16LE(end + 4) === 0 &&
      bytes.readUInt16LE(end + 6) === 0,
    "feedback_file_invalid",
  );
  let pos = start,
    total = 0;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    requireThat(
      pos + 46 <= end && bytes.readUInt32LE(pos) === 0x02014b50,
      "feedback_file_invalid",
    );
    const flags = bytes.readUInt16LE(pos + 8),
      method = bytes.readUInt16LE(pos + 10),
      compressed = bytes.readUInt32LE(pos + 20),
      expanded = bytes.readUInt32LE(pos + 24),
      length = bytes.readUInt16LE(pos + 28),
      extra = bytes.readUInt16LE(pos + 30),
      comment = bytes.readUInt16LE(pos + 32),
      offset = bytes.readUInt32LE(pos + 42);
    requireThat(
      pos + 46 + length + extra + comment <= end &&
        !(flags & 1) &&
        [0, 8].includes(method),
      "feedback_file_invalid",
    );
    const name = bytes.subarray(pos + 46, pos + 46 + length).toString("utf8");
    requireThat(
      !names.has(name) &&
        !name.includes("..") &&
        !name.startsWith("/") &&
        !name.includes("\\") &&
        !/vbaproject|activex|embeddings|\.exe$/i.test(name),
      "feedback_file_invalid",
    );
    names.add(name);
    total += expanded;
    requireThat(
      total <= 30 * 1024 * 1024 &&
        expanded <= 10 * 1024 * 1024 &&
        offset + 30 <= start &&
        bytes.readUInt32LE(offset) === 0x04034b50,
      "feedback_file_invalid",
    );
    const dataAt =
      offset +
      30 +
      bytes.readUInt16LE(offset + 26) +
      bytes.readUInt16LE(offset + 28);
    requireThat(
      dataAt + compressed <= start &&
        bytes.readUInt16LE(offset + 6) === flags &&
        bytes.readUInt16LE(offset + 8) === method &&
        bytes
          .subarray(offset + 30, offset + 30 + bytes.readUInt16LE(offset + 26))
          .toString("utf8") === name,
      "feedback_file_invalid",
    );
    if (name === "[Content_Types].xml" || name === office[ext][0]) {
      const input = bytes.subarray(dataAt, dataAt + compressed);
      const decoded =
        method === 8
          ? inflateRawSync(input, { maxOutputLength: 10 * 1024 * 1024 })
          : input;
      requireThat(
        decoded.length === expanded &&
          !/<!DOCTYPE|<!ENTITY/i.test(decoded.toString("utf8")),
        "feedback_file_invalid",
      );
      if (name === "[Content_Types].xml")
        requireThat(
          !/macroEnabled|vbaProject/i.test(decoded.toString("utf8")),
          "feedback_file_invalid",
        );
    }
    pos += 46 + length + extra + comment;
  }
  requireThat(
    pos === end &&
      names.has("[Content_Types].xml") &&
      names.has(office[ext][0]),
    "feedback_file_invalid",
  );
}
export async function validateFeedbackFile(name, base64) {
  requireThat(
    typeof base64 === "string" &&
      base64.length <= Math.ceil(FILE_LIMIT / 3) * 4 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(base64),
    "feedback_file_invalid",
  );
  let bytes = Buffer.from(base64, "base64");
  requireThat(
    bytes.length > 0 &&
      bytes.length <= FILE_LIMIT &&
      bytes.toString("base64") === base64,
    "feedback_file_invalid",
  );
  name = path
    .basename(String(name).replaceAll("\\", "/"))
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 160);
  const ext = path.extname(name).slice(1).toLowerCase();
  let mime;
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    const image = sharp(bytes, {
        limitInputPixels: 30000000,
        failOn: "warning",
      }),
      meta = await image.metadata();
    requireThat(
      ["png", "jpeg", "webp"].includes(meta.format) &&
        (!meta.pages || meta.pages === 1),
      "feedback_file_invalid",
    );
    bytes = await image
      .rotate()
      .toFormat(ext === "jpg" ? "jpeg" : ext)
      .toBuffer();
    mime = "image/" + (ext === "jpg" ? "jpeg" : ext);
  } else if (ext === "pdf") {
    const text = bytes.toString("latin1");
    requireThat(
      /^%PDF-\d\.\d/.test(text) &&
        /%%EOF\s*$/.test(text) &&
        !/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/i.test(text),
      "feedback_file_invalid",
    );
    mime = "application/pdf";
  } else if (office[ext]) {
    officeFile(bytes, ext);
    mime = office[ext][1];
  } else if (["txt", "csv"].includes(ext)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    requireThat(
      !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text),
      "feedback_file_invalid",
    );
    mime = ext === "csv" ? "text/csv" : "text/plain";
  } else requireThat(false, "feedback_file_type");
  requireThat(bytes.length <= FILE_LIMIT, "feedback_file_too_large", 413);
  return { name, mime, bytes };
}
