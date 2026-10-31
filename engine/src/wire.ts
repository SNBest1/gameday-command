/**
 * Wire format for the headless engine.
 *
 * JSON text frames carry messages with no typed arrays. A message with typed
 * arrays is a binary frame:
 *
 *   uint32 little-endian header length
 *   UTF-8 JSON header, with each typed array replaced by
 *     { "$ta": "Float32Array", "offset": n, "length": n }
 *   the arrays' bytes, each 8-byte aligned
 *
 * `offset` is relative to the body that follows the header. The encoder also
 * aligns the absolute frame offset, so a receiver can copy an array without
 * unaligned access.
 *
 * Pure functions: no Node or browser APIs.
 */
import type { WorkerIn, WorkerOut } from '../../contracts.ts';
import type { EditIn, EditOut } from './edits.ts';

export type WireMessage = WorkerIn | WorkerOut | EditIn | EditOut;

type TypedArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

const CONSTRUCTORS: Record<string, new (buffer: ArrayBuffer, byteOffset: number, length: number) => TypedArray> = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
};

const BYTES: Record<string, number> = {
  Float32Array: 4,
  Float64Array: 8,
  Int8Array: 1,
  Uint8Array: 1,
  Uint8ClampedArray: 1,
  Int16Array: 2,
  Uint16Array: 2,
  Int32Array: 4,
  Uint32Array: 4,
};

const isTyped = (value: unknown): value is TypedArray => ArrayBuffer.isView(value) && !(value instanceof DataView);

const align8 = (n: number) => (n + 7) & ~7;

function collect(value: unknown, arrays: TypedArray[]): unknown {
  if (isTyped(value)) {
    const name = value.constructor.name;
    if (!(name in CONSTRUCTORS)) throw new Error(`unsupported typed array ${name}`);
    arrays.push(value);
    return { $ta: name, offset: 0, length: value.length };
  }
  if (Array.isArray(value)) return value.map((item) => collect(item, arrays));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) out[key] = collect(child, arrays);
    return out;
  }
  return value;
}

/** Replace the placeholders with typed arrays sliced out of the body. */
function rebuild(value: unknown, body: Uint8Array): unknown {
  if (Array.isArray(value)) return value.map((item) => rebuild(item, body));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$ta === 'string' && typeof record.offset === 'number' && typeof record.length === 'number') {
    const ctor = CONSTRUCTORS[record.$ta];
    const bytes = BYTES[record.$ta];
    if (!ctor || bytes === undefined) throw new Error(`unsupported typed array ${record.$ta}`);
    const start = record.offset;
    const end = start + record.length * bytes;
    if (start < 0 || end > body.byteLength) throw new Error(`typed array out of bounds: ${record.$ta}`);
    const copy = body.slice(start, end);
    return new ctor(copy.buffer, 0, record.length);
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) out[key] = rebuild(child, body);
  return out;
}

export function encode(message: WireMessage): string | Uint8Array {
  const arrays: TypedArray[] = [];
  const header = collect(message, arrays);
  if (arrays.length === 0) return JSON.stringify(message);

  const frameStart = 4;
  const apply = (value: unknown, offsets: number[], index: { n: number }): unknown => {
    if (Array.isArray(value)) return value.map((item) => apply(item, offsets, index));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (typeof record.$ta === 'string') {
      return { ...record, offset: offsets[index.n++]! };
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) out[key] = apply(child, offsets, index);
    return out;
  };
  const buildHeader = (offsets: number[]) => JSON.stringify(apply(header, offsets, { n: 0 }));
  const computeOffsets = (headerLength: number) => {
    const bodyStart = frameStart + headerLength;
    const offsets: number[] = [];
    let cursor = 0;
    for (const array of arrays) {
      const absolute = align8(bodyStart + cursor);
      const offset = absolute - bodyStart;
      offsets.push(offset);
      cursor = align8(offset + array.byteLength);
    }
    return { offsets, bodyLength: cursor };
  };

  // Adding offsets can change the header's length, which changes the offsets.
  // Iterate until the header length is stable; in practice this settles at once.
  let offsets = arrays.map(() => 0);
  let headerText = buildHeader(offsets);
  let bodyLength = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const computed = computeOffsets(new TextEncoder().encode(headerText).length);
    offsets = computed.offsets;
    bodyLength = computed.bodyLength;
    const next = buildHeader(offsets);
    if (next.length === headerText.length) {
      headerText = next;
      break;
    }
    headerText = next;
  }
  const finalHeader = new TextEncoder().encode(headerText);

  const frame = new Uint8Array(align8(frameStart + finalHeader.length + bodyLength));
  new DataView(frame.buffer).setUint32(0, finalHeader.length, true);
  frame.set(finalHeader, frameStart);
  const bodyStart = frameStart + finalHeader.length;
  arrays.forEach((array, i) => {
    frame.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), bodyStart + offsets[i]!);
  });
  return frame;
}

export function decode(data: string | ArrayBuffer | Uint8Array): WireMessage {
  if (typeof data === 'string') return JSON.parse(data) as WireMessage;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 4) throw new Error('wire frame too short');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (headerLength > bytes.byteLength - 4) throw new Error('wire header out of bounds');
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))) as unknown;
  return rebuild(header, bytes.subarray(4 + headerLength)) as WireMessage;
}
