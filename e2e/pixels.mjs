// The pixels of a screenshot, to check a point view against what the GPU
// drew (.claude/skills/coding/testing.md, "Checking the projection against
// the pixels"): a reader of the PNG files Playwright writes, 8 bits per
// channel, RGB or RGBA, not interlaced, which is all it writes.
import { Buffer } from "node:buffer";
import zlib from "node:zlib";

/**
 * The pixel at `x`, `y`, in CSS pixels of the page, of a screenshot of
 * `page` at a device pixel ratio of 1, as `[red, green, blue]`.
 */
export async function pixelAt(page, x, y) {
  const png = await page.screenshot({
    clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 },
  });
  const { width, channels, rows } = decode(png);
  if (width < 1 || rows.length < 1) throw new Error("e2e: a screenshot of no pixel");
  const [red, green, blue] = rows[0].subarray(0, channels);
  return [red, green, blue];
}

/**
 * The centre of the pixels within `reach` CSS pixels of `x`, `y` whose
 * colour is `colour` within 12 in each channel, in CSS pixels of the page,
 * of a screenshot at a device pixel ratio of 1; `null` when there is none.
 */
export async function centreOfColour(page, x, y, colour, reach = 6) {
  const left = Math.floor(x) - reach;
  const top = Math.floor(y) - reach;
  const side = 2 * reach + 1;
  const png = await page.screenshot({ clip: { x: left, y: top, width: side, height: side } });
  const { channels, rows } = decode(png);
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < row.length / channels; column += 1) {
      const pixel = row.subarray(column * channels, column * channels + 3);
      if (pixel.every((value, index) => Math.abs(value - colour[index]) <= 12)) {
        count += 1;
        sumX += left + column + 0.5;
        sumY += top + rowIndex + 0.5;
      }
    }
  });
  return count === 0 ? null : { x: sumX / count, y: sumY / count };
}

/** Decodes a PNG of 8 bits per channel into its rows of pixels. */
function decode(png) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => png[index] === byte)) throw new Error("e2e: not a PNG");
  let at = 8;
  let header = null;
  const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const chunk = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      header = {
        width: chunk.readUInt32BE(0),
        height: chunk.readUInt32BE(4),
        depth: chunk[8],
        colour: chunk[9],
        interlace: chunk[12],
      };
    } else if (type === "IDAT") {
      data.push(chunk);
    }
    at += 12 + length;
  }
  if (header === null || header.depth !== 8 || header.interlace !== 0) {
    throw new Error(`e2e: a PNG this reader does not read: ${JSON.stringify(header)}`);
  }
  const channels = { 2: 3, 6: 4 }[header.colour];
  if (channels === undefined) throw new Error(`e2e: a PNG of colour type ${header.colour}`);
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = header.width * channels;
  const rows = [];
  let previous = new Uint8Array(stride);
  for (let row = 0; row < header.height; row += 1) {
    const start = row * (stride + 1);
    const filter = raw[start];
    const line = Uint8Array.from(raw.subarray(start + 1, start + 1 + stride));
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      line[i] = (line[i] + unfilter(filter, left, up, upLeft)) & 255;
    }
    rows.push(line);
    previous = line;
  }
  return { width: header.width, channels, rows };
}

/** What a PNG filter adds back to a byte, from its neighbours. */
function unfilter(filter, left, up, upLeft) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4: {
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    default:
      throw new Error(`e2e: a PNG filter ${filter}`);
  }
}
