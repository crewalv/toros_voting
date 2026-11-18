import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8000/api';
let cookie;
async function call(path, data, expected = 200, authenticated = true) {
  const response = await fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Toros-Request': '1', 'Content-Type': 'application/json', ...(authenticated && cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.equal(response.status, expected, path + ' ' + await response.clone().text());
  return response;
}
const login = await call('/admin/login', { login: process.env.ADMIN_LOGIN, password: process.env.ADMIN_PASSWORD });
cookie = login.headers.get('set-cookie').split(';')[0];
await call('/admin/lottery/import', {tickets: []}, 401, false);
const tickets = [{sector:'1',row:'5',seat:'20'}, {sector:'2',row:'3',seat:'40'}];
await call('/admin/lottery/import', {tickets:[...tickets,tickets[0]]});
assert.equal((await (await call('/lottery')).json()).total,2);
await call('/admin/lottery/import', {tickets:[{sector:'0',row:'2',seat:'3'}]},400);
const id = 'a'.repeat(32);
await call('/admin/lottery/draw', {requestId:id});
await call('/admin/lottery/draw', {requestId:id});
let state = await (await call('/lottery')).json();
assert.equal(state.remaining,1);
assert.equal(state.winner,null);
assert.equal(state.winners.length,0);
await call('/admin/lottery/draw', {requestId:'b'.repeat(32)},409);
await call('/admin/lottery/import', {tickets},409);
await new Promise(resolve=>setTimeout(resolve,10300));
state = await (await call('/lottery')).json();
const first=state.winner;
assert.ok(first);
await call('/admin/lottery/draw', {requestId:'c'.repeat(32)});
await new Promise(resolve=>setTimeout(resolve,10300));
state = await (await call('/lottery')).json();
assert.notDeepEqual(state.winner,first);
assert.equal(state.remaining,0);
assert.equal(state.winners.length,2);
await call('/admin/lottery/draw', {requestId:id});
assert.equal((await (await call('/lottery')).json()).remaining,0);
await call('/admin/lottery/draw', {requestId:'d'.repeat(32)},409);
console.log('Lottery auth, import, duplicate protection, hidden reveal, draw locking and winner exclusion passed.');
