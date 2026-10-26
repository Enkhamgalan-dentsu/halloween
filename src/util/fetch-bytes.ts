export type ByteProgress = (loadedBytes: number, totalBytes: number | null) => void;

/**
 * fetch() a binary file while reporting download progress.
 * `totalBytes` is null when the server compresses the response (Content-Length is then
 * the compressed size, which can't be compared with the decompressed byte count).
 */
export async function fetchBytes(url: string, onProgress?: ByteProgress): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);

  const length = res.headers.get('content-length');
  const total = length && !res.headers.get('content-encoding') ? Number(length) : null;

  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onProgress?.(bytes.byteLength, bytes.byteLength);
    return bytes;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
