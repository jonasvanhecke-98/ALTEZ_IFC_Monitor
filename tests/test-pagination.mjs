import assert from 'node:assert/strict';
import { listProjectsPage } from '../js/trimble.js';

const seen = [];
globalThis.fetch = async url => {
  const u = new URL(String(url));
  seen.push(u.href);
  const page = Number(u.searchParams.get('page'));
  const pageSize = Number(u.searchParams.get('pageSize'));
  const start = (page - 1) * pageSize;
  const amount = Math.max(0, Math.min(pageSize, 120 - start));
  const projects = Array.from({ length: amount }, (_, i) => ({ id: `p${start+i+1}`, name: `Project ${start+i+1}` }));
  return new Response(JSON.stringify({ projects, totalCount: 120 }), { status: 200, headers: { 'content-type':'application/json' } });
};

const p1 = await listProjectsPage('europe', 'token', undefined, { page:1, pageSize:50 });
const p2 = await listProjectsPage('europe', 'token', undefined, { page:2, pageSize:50 });
const p3 = await listProjectsPage('europe', 'token', undefined, { page:3, pageSize:50 });
assert.equal(p1.projects.length, 50); assert.equal(p1.hasMore, true); assert.equal(p1.total, 120);
assert.equal(p2.projects.length, 50); assert.equal(p2.hasMore, true);
assert.equal(p3.projects.length, 20); assert.equal(p3.hasMore, false);
assert.ok(seen.every(x => x.startsWith('https://app21.connect.trimble.com/')));
assert.ok(seen.every(x => !x.endsWith('/regions')));
console.log('Project pagination tests OK');
