/**
 * Download the Jülich reference data used by the validation suite.
 *
 * The raw files are deliberately not committed: they are large and the archive
 * is the source of record. This script writes them under validation/reference/raw
 * (gitignored) and checks the SHA-256 recorded in validation/reference/SOURCES.md.
 *
 *   node validation/fetch-reference.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = resolve(ROOT, 'validation/reference/raw');

interface Source {
  file: string;
  url: string;
  sha256: string;
}

const SOURCES: Source[] = [
  {
    file: 'corridor/2013unidirectional_metadata.json',
    url: 'http://ped.fz-juelich.de/experiments/2013.06.19_Duesseldorf_Messe_BaSiGo/data/2013unidirectional/2013unidirectional_metadata.json',
    sha256: '2c1635c73225f8bb36291adeefd4db5831f64c2ced7da5793c266acf0ec3d2c2',
  },
  {
    file: 'corridor/traj_UNI_CORR_500_05.txt',
    url: 'http://ped.fz-juelich.de/experiments/2013.06.19_Duesseldorf_Messe_BaSiGo/result/corrected/UNI_CORR_500_Gregor/traj_UNI_CORR_500_05.txt',
    sha256: 'a31c2a95b83c737415c7d6fcf24d9ef75ab53c20d85ad776974d5c3e645b08a3',
  },
  {
    file: 'bottleneck/2005bottleneck1_metadata.json',
    url: 'http://ped.fz-juelich.de/experiments/2005.12.07_Juelich_Rotunde_Bottleneck/data/2005bottleneck1_metadata.json',
    sha256: '03d95ccf4d5e1716fca9c0107a0f14fd8b83881d70c4737b41fa85a879f9eef7',
  },
  {
    file: 'bottleneck/trajectories_txt.zip',
    url: 'http://ped.fz-juelich.de/experiments/2005.12.07_Juelich_Rotunde_Bottleneck/data/trajectories_txt.zip',
    sha256: '59b11bda136d4660e61a623900e7f0f3028254f3d07c8da2997f2f44537bce46',
  },
];

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function download(source: Source): Promise<void> {
  const out = resolve(RAW, source.file);
  mkdirSync(dirname(out), { recursive: true });
  if (existsSync(out) && sha256(readFileSync(out)) === source.sha256) {
    console.log(`ok       ${source.file}`);
    return;
  }
  console.log(`download ${source.url}`);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = sha256(bytes);
  if (hash !== source.sha256) {
    throw new Error(`${source.file}: SHA-256 ${hash}, expected ${source.sha256}`);
  }
  writeFileSync(out, bytes);
  console.log(`saved    ${source.file} (${bytes.length.toLocaleString()} bytes)`);
}

/** Minimal ZIP reader for one stored/deflated directory; enough for this archive. */
function unzip(buffer: Buffer, outDir: string): string[] {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a ZIP file: no end-of-central-directory record');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const written: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central-directory entry');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name.endsWith('.txt') || name.includes('__MACOSX')) continue;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`${name}: unsupported ZIP compression method ${method}`);
    const out = resolve(outDir, basename(name));
    writeFileSync(out, data);
    written.push(out);
  }
  return written;
}

async function main(): Promise<void> {
  for (const source of SOURCES) await download(source);
  const zip = readFileSync(resolve(RAW, 'bottleneck/trajectories_txt.zip'));
  const files = unzip(zip, resolve(RAW, 'bottleneck'));
  console.log(`extracted ${files.length} bottleneck trajectory files into validation/reference/raw/bottleneck/`);
}

await main();
