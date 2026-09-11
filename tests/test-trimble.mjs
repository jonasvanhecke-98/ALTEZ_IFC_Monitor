import assert from 'node:assert/strict';
import { listProjectsAcrossRegions, listProjectFiles, getDownloadUrl, isIfcFile } from '../js/trimble.js';

const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const u = String(url);
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

  if (u.endsWith('/regions')) return json([{ origin: 'https://app21.connect.trimble.com' }]);
  if (u.includes('/projects?')) return json({ projects: [{ id: 'p1', name: 'Project Test', rootId: 'root1' }], totalCount: 1 });
  if (u.endsWith('/folders/root1/items')) return json([
    { id: 'folder1', name: 'Models', type: 'FOLDER' },
    { id: 'pdf1', name: 'Plan.pdf', type: 'FILE' }
  ]);
  if (u.endsWith('/folders/folder1/items')) return json([
    { id: 'f1', name: 'Structuur.ifc', type: 'FILE', versionId: 'v1', modifiedOn: '2026-09-11T10:00:00Z' },
    { id: 'f2', name: 'HVAC.ifczip', type: 'FILE', versionId: 'v2' }
  ]);
  if (u.includes('/files/fs/f1/downloadurl')) return new Response('https://storage.example/Structuur.ifc', { status: 200, headers: { 'content-type': 'text/plain' } });
  return new Response('Not found', { status: 404 });
};

const { projects, warnings } = await listProjectsAcrossRegions('token');
assert.equal(warnings.length, 0);
assert.equal(projects.length, 1);
assert.equal(projects[0].name, 'Project Test');
assert.equal(projects[0]._apiBase, 'https://app21.connect.trimble.com/tc/api/2.0');

const files = await listProjectFiles(projects[0], 'token');
assert.equal(files.length, 3);
const ifcs = files.filter(isIfcFile);
assert.deepEqual(ifcs.map(f => f.name).sort(), ['HVAC.ifczip', 'Structuur.ifc']);

const url = await getDownloadUrl(projects[0], ifcs.find(f => f.name === 'Structuur.ifc'), 'token');
assert.equal(url, 'https://storage.example/Structuur.ifc');
assert.ok(calls.some(x => x.includes('/files/fs/f1/downloadurl?versionId=v1')));

console.log('Trimble API flow tests OK');
