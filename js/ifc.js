function normalizedTarget(target) {
  return String(target || '').trim();
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function psetRegex(target) {
  const name = regexEscape(normalizedTarget(target));
  if (!name) return null;
  // IFC STEP: IFCPROPERTYSET(GlobalId, OwnerHistory, Name, Description, HasProperties)
  // We match the actual Name argument rather than a loose text occurrence.
  return new RegExp(`IFCPROPERTYSET\\s*\\(\\s*[^,;]*,\\s*[^,;]*,\\s*'${name}'(?:\\s*,|\\s*\\))`, 'i');
}

export function bufferContainsText(buffer, target) {
  const needle = normalizedTarget(target).toLowerCase();
  if (!needle) return false;
  const text = new TextDecoder('latin1').decode(buffer).toLowerCase();
  return text.includes(needle);
}

export function bufferContainsPset(buffer, target) {
  const rx = psetRegex(target);
  if (!rx) return false;
  return rx.test(new TextDecoder('latin1').decode(buffer));
}

export async function responseContainsPset(response, target) {
  const rx = psetRegex(target);
  if (!rx) return false;
  if (!response.body?.getReader) return bufferContainsPset(await response.arrayBuffer(), target);

  const reader = response.body.getReader();
  const decoder = new TextDecoder('latin1');
  let tail = '';
  // More than enough room for a wrapped IFCPROPERTYSET STEP statement header.
  const keep = 8192;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = tail + decoder.decode(value, { stream: true });
    if (rx.test(chunk)) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return true;
    }
    tail = chunk.slice(-keep);
  }
  return rx.test(tail + decoder.decode());
}

function findEocd(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Deze browser ondersteunt IFCZIP-decompressie niet. Gebruik een recente Chrome/Edge-versie.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function extractIfcFromZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('Ongeldig IFCZIP-bestand: ZIP-index niet gevonden.');

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);

  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('Ongeldig IFCZIP-bestand: central directory beschadigd.');
    }
    const compression = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const fileName = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + fileNameLength));

    if (fileName.toLowerCase().endsWith('.ifc')) {
      if (localHeaderOffset + 30 > bytes.byteLength || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error('Ongeldig IFCZIP-bestand: local header ontbreekt.');
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      if (compression === 0) return compressed;
      if (compression === 8) return inflateRaw(compressed);
      throw new Error(`IFCZIP compressiemethode ${compression} wordt niet ondersteund.`);
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  throw new Error('IFCZIP bevat geen .ifc-bestand.');
}

export async function scanIfcUrl(downloadUrl, fileName, targetPset, signal) {
  const response = await fetch(downloadUrl, { signal });
  if (!response.ok) throw new Error(`Download mislukt (${response.status} ${response.statusText}).`);
  const lower = String(fileName || '').toLowerCase();

  if (lower.endsWith('.ifc')) return responseContainsPset(response, targetPset);
  if (lower.endsWith('.ifczip')) {
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 300 * 1024 * 1024) {
      throw new Error('IFCZIP is groter dan 300 MB; v1 slaat dit bestand over om de browser stabiel te houden.');
    }
    const ifcBytes = await extractIfcFromZip(await response.arrayBuffer());
    return bufferContainsPset(ifcBytes, targetPset);
  }
  throw new Error('Geen ondersteund IFC-bestand.');
}
