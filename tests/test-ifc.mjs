import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bufferContainsText, bufferContainsPset, responseContainsPset, extractIfcFromZip } from '../js/ifc.js';

const goodText = "ISO-10303-21;\n#1=IFCPROPERTYSET('x',$,'Altez_IFC',$,(#2));\nENDSEC;";
const wrappedText = "#5=IFCPROPERTYSET(\n'guid',\n#99,\n'ALTEZ_IFC',\n$,\n(#2));";
const badText = "#1=IFCPROPERTYSINGLEVALUE('Altez_IFC',$,IFCTEXT('geen pset'),$);";
const good = new TextEncoder().encode(goodText);
const bad = new TextEncoder().encode(badText);

assert.equal(bufferContainsText(good, 'altez_ifc'), true);
assert.equal(bufferContainsPset(good, 'Altez_IFC'), true);
assert.equal(bufferContainsPset(new TextEncoder().encode(wrappedText), 'altez_ifc'), true);
assert.equal(bufferContainsPset(bad, 'Altez_IFC'), false, 'losse propertynaam mag geen false positive geven');

// Streaming check with the property set deliberately split across chunks.
const chunks = ["#5=IFCPROP", "ERTYSET('guid',$,'Alt", "ez_IFC',$,(#2));"];
const stream = new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  }
});
assert.equal(await responseContainsPset(new Response(stream), 'Altez_IFC'), true);

if (process.argv[2]) {
  const filePath = process.argv[2];
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ifc') {
    assert.equal(bufferContainsPset(data, 'Altez_IFC'), true);
  } else if (ext === '.ifczip' || ext === '.zip') {
    const extracted = await extractIfcFromZip(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    assert.equal(bufferContainsPset(extracted, 'Altez_IFC'), true);
  } else {
    throw new Error(`Niet-ondersteund testbestand: ${ext}`);
  }
}
console.log('IFC scanner tests OK');
