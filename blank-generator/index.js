#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const PAGE_SIZES = {
  A3: [842, 1191],
  A4: [595, 842],
  A5: [420, 595],
  LETTER: [612, 792],
  LEGAL: [612, 1008],
};
const SIZE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
const LENGTH_UNITS = { pt: 1, mm: 72 / 25.4, cm: 72 / 2.54, in: 72 };
const CHUNK = 1024 * 1024;
const PADDING_TEXT = 'Padding text for file size testing\n';
const PADDING_CHUNK = Buffer.from(PADDING_TEXT.repeat(Math.ceil(CHUNK / PADDING_TEXT.length)).slice(0, CHUNK), 'latin1');
const MAX_SIZE = 9_000_000_000;

const HELP = `Usage: node index.js [options]

Options:
  -s, --size <size>     Exact file size: 12345, 500KB, 5MB, 1.5GB (1KB = 1024 B)
  -p, --pages <n>       Number of pages (default: 1)
      --page <format>   A3, A4, A5, Letter, Legal or WIDTHxHEIGHT[pt|mm|cm|in]
                        e.g. 100x150mm (default: A4)
                        For JPEG the size is in pixels at 72 DPI
  -f, --format <type>   pdf or jpeg (default: from --out extension, else pdf)
  -o, --out <file>      Output file (default: output.pdf)
  -h, --help            Show this help

Examples:
  node index.js --size 5MB
  node index.js -s 250KB -p 10 --page Letter -o files/letter.pdf
  node index.js -s 1GB --page 100x150mm -o big.pdf
  node index.js -s 2MB -f jpeg --page 1920x1080`;

function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(value).trim());
  if (!match) throw new Error(`Invalid size: ${value}`);
  const bytes = Math.floor(parseFloat(match[1]) * SIZE_UNITS[(match[2] || 'b').toLowerCase()]);
  if (bytes > MAX_SIZE) throw new Error(`Size too large (max ${MAX_SIZE} bytes)`);
  return bytes;
}

function parsePageSize(value) {
  const named = PAGE_SIZES[String(value).toUpperCase()];
  if (named) return named;
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(pt|mm|cm|in)?$/i.exec(String(value).trim());
  if (!match) throw new Error(`Invalid page size: ${value}`);
  const factor = LENGTH_UNITS[(match[3] || 'pt').toLowerCase()];
  return [match[1], match[2]].map((n) => Math.round(parseFloat(n) * factor * 100) / 100);
}

function parseArgs(argv) {
  const args = { size: null, pages: 1, page: PAGE_SIZES.A4, out: 'output.pdf', format: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = () => {
      if (argv[i + 1] === undefined) throw new Error(`Missing value for ${key}`);
      return argv[++i];
    };
    switch (key) {
      case '-s':
      case '--size':
        args.size = parseSize(next());
        break;
      case '-p':
      case '--pages':
        args.pages = parseInt(next(), 10);
        if (!Number.isInteger(args.pages) || args.pages < 1) throw new Error('Pages must be a positive integer');
        break;
      case '--page':
        args.page = parsePageSize(next());
        break;
      case '-o':
      case '--out':
        args.out = next();
        break;
      case '-f':
      case '--format':
        args.format = next().toLowerCase().replace(/^jpg$/, 'jpeg');
        if (!['pdf', 'jpeg'].includes(args.format)) throw new Error('Format must be pdf or jpeg');
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }
  return args;
}

function formatBytes(bytes) {
  if (bytes === null) return 'minimal';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number(value.toFixed(2))} ${units[unit]}`;
}

function withSizeInName(file, bytes) {
  if (bytes === null) return file;
  const { dir, name, ext } = path.parse(file);
  const megabytes = Number((bytes / SIZE_UNITS.mb).toFixed(2));
  return path.join(dir, `${name}-${megabytes}MB${ext || '.pdf'}`);
}

function buildLayout(paddingLength, { pages, width, height, label }) {
  const segments = [];
  const offsets = [];
  let position = 0;

  const push = (data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
    segments.push(buffer);
    position += buffer.length;
  };
  const object = (id, body) => {
    offsets[id] = position;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  push(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'));

  const pageIds = Array.from({ length: pages }, (_, i) => 5 + i * 2);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  offsets[4] = position;
  push(`4 0 obj\n<< /Length ${paddingLength} >>\nstream\n`);
  segments.push({ padding: paddingLength });
  position += paddingLength;
  push('\nendstream\nendobj\n');

  const fontSize = Math.max(4, Math.min(24, Math.floor(width / 20)));
  const margin = Math.min(50, width / 10);
  pageIds.forEach((id, i) => {
    const content = [
      'BT',
      `/F1 ${fontSize} Tf`,
      `${margin} ${height - margin - fontSize} Td`,
      `(Page ${i + 1} of ${pages}) Tj`,
      `0 ${-fontSize * 1.5} Td`,
      `(${label}) Tj`,
      'ET',
    ].join('\n');
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`
    );
    object(id + 1, `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  });

  const count = offsets.length;
  const xrefOffset = position;
  const entries = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  push(`xref\n0 ${count}\n0000000000 65535 f \n${entries}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return { segments, total: position, trailing: 0 };
}

function solveLayout(target, options) {
  const base = buildLayout(0, options);
  if (target === null) return base;
  if (target < base.total) {
    throw new Error(`Minimum possible size for these options is ${base.total} bytes`);
  }

  let padding = target - base.total;
  for (let i = 0; i < 10; i++) {
    const diff = target - buildLayout(padding, options).total;
    if (diff === 0) break;
    padding = Math.max(0, padding + diff);
  }

  let layout = buildLayout(padding, options);
  while (layout.total > target && padding > 0) {
    layout = buildLayout(--padding, options);
  }
  layout.trailing = target - layout.total;
  layout.total = target;
  return layout;
}

function writeChunk(stream, buffer) {
  return new Promise((resolve, reject) => {
    stream.write(buffer, (error) => (error ? reject(error) : resolve()));
  });
}

async function writePdf(file, layout) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const stream = fs.createWriteStream(file);
  const finished = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  for (const segment of layout.segments) {
    if (Buffer.isBuffer(segment)) {
      await writeChunk(stream, segment);
      continue;
    }
    let remaining = segment.padding;
    while (remaining > 0) {
      const length = Math.min(remaining, CHUNK);
      await writeChunk(stream, PADDING_CHUNK.subarray(0, length));
      remaining -= length;
    }
  }
  if (layout.trailing > 0) await writeChunk(stream, Buffer.alloc(layout.trailing, 0x0a));

  stream.end();
  await finished;
}

function jpegSegment(marker, payload) {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(marker, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function buildJpeg(width, height) {
  const app0 = jpegSegment(0xffe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 1, 0, 72, 0, 72, 0, 0]));
  const dqt = jpegSegment(0xffdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]));
  const sof = jpegSegment(
    0xffc0,
    Buffer.from([8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0])
  );
  const singleCodeTable = (tableClass) => Buffer.from([tableClass, 1, ...new Array(15).fill(0), 0x00]);
  const dht = jpegSegment(0xffc4, Buffer.concat([singleCodeTable(0x00), singleCodeTable(0x10)]));
  const sos = jpegSegment(0xffda, Buffer.from([1, 1, 0x00, 0, 63, 0]));

  const bits = Math.ceil(width / 8) * Math.ceil(height / 8) * 2;
  const scan = Buffer.alloc(Math.ceil(bits / 8), 0);
  if (bits % 8) scan[scan.length - 1] = (1 << (8 - (bits % 8))) - 1;

  return {
    head: Buffer.concat([Buffer.from([0xff, 0xd8]), app0]),
    body: Buffer.concat([dqt, sof, dht, sos, scan, Buffer.from([0xff, 0xd9])]),
  };
}

function commentSizes(total) {
  const max = 65537;
  const sizes = [];
  let remaining = total;
  while (remaining > 0) {
    let size = Math.min(remaining, max);
    if (remaining - size > 0 && remaining - size < 4) size -= 4;
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

async function writeJpeg(file, target, width, height) {
  if (width < 1 || height < 1 || width > 65535 || height > 65535) {
    throw new Error('JPEG dimensions must be between 1 and 65535 pixels');
  }
  const { head, body } = buildJpeg(width, height);
  const base = head.length + body.length;
  const padding = target === null ? 0 : target - base;
  if (padding < 0) throw new Error(`Minimum possible size for these options is ${base} bytes`);
  if (padding > 0 && padding < 4) throw new Error(`Size must be ${base} or at least ${base + 4} bytes`);

  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const stream = fs.createWriteStream(file);
  const finished = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  await writeChunk(stream, head);
  for (const size of commentSizes(padding)) {
    await writeChunk(stream, jpegSegment(0xfffe, PADDING_CHUNK.subarray(0, size - 4)));
  }
  await writeChunk(stream, body);

  stream.end();
  await finished;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const isJpegName = /\.jpe?g$/i.test(args.out);
  const format = args.format || (isJpegName ? 'jpeg' : 'pdf');
  if (format === 'jpeg' && !isJpegName) {
    const { dir, name } = path.parse(args.out);
    args.out = path.join(dir, `${name}.jpg`);
  }
  args.out = withSizeInName(args.out, args.size);

  if (format === 'jpeg') {
    const [width, height] = args.page.map(Math.round);
    await writeJpeg(args.out, args.size, width, height);
    const actual = fs.statSync(args.out).size;
    console.log(`Created ${args.out}: ${actual} bytes (${formatBytes(actual)}), ${width}x${height} px`);
    return;
  }

  const [width, height] = args.page;
  const label = `Size: ${formatBytes(args.size)}  Page: ${width}x${height} pt`;
  const layout = solveLayout(args.size, { pages: args.pages, width, height, label });
  await writePdf(args.out, layout);

  const actual = fs.statSync(args.out).size;
  console.log(
    `Created ${args.out}: ${actual} bytes (${formatBytes(actual)}), ${args.pages} page(s), ${width}x${height} pt`
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseSize, parsePageSize, solveLayout, writePdf, writeJpeg };
