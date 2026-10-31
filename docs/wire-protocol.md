# Engine wire protocol

Version: **gameday-wire.1**

The server runs the same simulation core as the browser worker. A client talks
to it over `POST /api/runs` and a WebSocket.

## Endpoints

- `POST /api/runs` — body is the same `init` payload the app sends a browser
  worker today (`WorkerIn` with `type: "init"`). Returns `{ "id": "<run id>" }`.
- `GET /api/runs/:id/ws` — upgrades to a WebSocket. The first server message is:

  ```json
  { "type": "hello", "protocol": "gameday-wire.1" }
  ```

- `DELETE /api/runs/:id` — terminates the worker.

## Framing

The socket carries the same messages as the worker boundary:

- `WorkerIn` and `EditIn` — client to server.
- `WorkerOut` and `EditOut` — server to client.
- `hello` — server to client, first message only.

A message with no typed arrays is sent as a **JSON text frame**.

A message that contains typed arrays is sent as one **binary frame**:

1. `uint32` little-endian: the byte length of the JSON header.
2. UTF-8 JSON header.
3. The typed arrays' bytes.

In the header, each typed array is replaced by an object:

```json
{ "$ta": "Float32Array", "offset": 24, "length": 20000 }
```

`$ta` is the constructor name. `offset` is the byte offset from the start of
the body that follows the header. `length` is the number of elements. The
supported names are `Float32Array`, `Float64Array`, `Int8Array`, `Uint8Array`,
`Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array` and
`Uint32Array`.

Every array starts on an 8-byte boundary of the whole frame. A receiver may
copy the bytes out with the offset and length in the header; `engine/src/wire.ts`
does that and reconstructs the original typed-array constructors.

The body length is implied by the frame length. Padding bytes are zero.

## Examples

A frame message with density is binary; it carries `TickFrame` arrays and the
density grid. A scorecard, ready, done or error message carries no typed arrays
and is text. A scene message is binary only when it carries an alert's dot
array or recorded motion paths; otherwise it is text.

## Encoding helpers

`engine/src/wire.ts` exports:

- `encode(message): string | Uint8Array`
- `decode(data: string | ArrayBuffer | Uint8Array): message`

Both are pure functions and work in the browser and in Node.
