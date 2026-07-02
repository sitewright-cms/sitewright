/** One decoded Server-Sent Event: an optional `event:` name + its `data:` payload. */
export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Incrementally parse an SSE byte stream into `{event, data}` records. Robust to the
 * things streaming LLM APIs actually do: chunk boundaries that split a line mid-way,
 * multi-line `data:` fields, CRLF, and `:` keep-alive comments. Yields once per
 * blank-line-terminated event block. Stops promptly if `signal` aborts.
 *
 * Both provider adapters consume this; the vendor-specific decoding of each `data`
 * payload lives in the adapter, not here.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const ev = parseBlock(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (ev) yield ev;
      }
    }
    const tail = parseBlock(buf.replace(/\r\n/g, '\n'));
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
