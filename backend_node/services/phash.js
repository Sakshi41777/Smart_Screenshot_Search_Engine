// backend_node/services/phash.js
// Perceptual "difference hash" (dHash) for images.
// Two images that look the same (resized, recompressed, PNG vs JPG, small edits)
// get hashes that differ in only a few of their 64 bits.
const sharp = require("sharp");

// Returns a 16-char hex string, or null if the image can't be read.
async function dHash(input) {
  try {
    const { data } = await sharp(input, { failOn: "none" })
      .rotate() // respect EXIF orientation
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let hash = 0n;
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const left = data[y * 9 + x];
        const right = data[y * 9 + x + 1];
        hash = (hash << 1n) | (left > right ? 1n : 0n);
      }
    }
    return hash.toString(16).padStart(16, "0");
  } catch {
    return null;
  }
}

// 1.0 = identical look, ~0.5 = unrelated images.
function hashSimilarity(a, b) {
  if (!a || !b) return 0;
  try {
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let diff = 0;
    while (x) {
      diff += Number(x & 1n);
      x >>= 1n;
    }
    return 1 - diff / 64;
  } catch {
    return 0;
  }
}

module.exports = { dHash, hashSimilarity };
