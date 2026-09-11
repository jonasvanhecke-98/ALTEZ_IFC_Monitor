import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key,val) => store.set(key,String(val)),
  removeItem: key => store.delete(key)
};
const { saveProjectListCache, loadProjectListCache } = await import('../js/cache.js');
const projects = [{ id:'p1', name:'Project 1', rootId:'r1', _apiBase:'https://app21.connect.trimble.com/tc/api/2.0', _regionKey:'europe', _regionLabel:'Europa' }];
assert.equal(saveProjectListCache('europe', projects, { page:2, pageSize:50, hasMore:true, total:120 }), true);
const cached = loadProjectListCache('europe', 10000);
assert.equal(cached.projects.length, 1);
assert.equal(cached.page, 2);
assert.equal(cached.pageSize, 50);
assert.equal(cached.hasMore, true);
assert.equal(cached.total, 120);
console.log('Project cache tests OK');
