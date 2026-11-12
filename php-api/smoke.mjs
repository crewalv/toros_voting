import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8000';
const login = process.env.ADMIN_LOGIN;
const password = process.env.ADMIN_PASSWORD;
assert(login && password, 'Set ADMIN_LOGIN and ADMIN_PASSWORD for a disposable local test database.');

async function call(path, { method = 'GET', body, cookie, status = 200 } = {}) {
  const headers = { 'X-Toros-Request': '1' };
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, status, path);
  return response;
}

const session = response => response.headers.get('set-cookie').split(';')[0];
await call('/health');
const admin = session(await call('/admin/login', { method: 'POST', body: { login, password } }));
const overview = await (await call('/admin/overview', { cookie: admin })).json();
const awayId = overview.teams.find(team => team.name !== 'Торос').id;
const { id } = await (await call('/admin/matches', { method: 'POST', cookie: admin, status: 201,
  body: { awayId, startsAt: new Date().toISOString(), tournament: 'PHP smoke test' } })).json();
const match = '/matches/' + id;
const manage = '/admin' + match;
const action = (kind, scores) => call(manage + '/action', { method: 'POST', cookie: admin, body: { kind, ...scores } });

try {
  await call(manage, { method: 'DELETE', status: 401 });
  const qr = await call(match + '/qr');
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await qr.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await action('open');
  const voter = session(await call(match + '/session', { method: 'POST' }));
  const vote = async body => (await (await call(match + '/predictions', { method: 'POST', cookie: voter, body })).json()).prediction;
  const first = await vote({ homeScore: 3, awayScore: 2 });
  const repeat = await vote({ homeScore: 9, awayScore: 9 });
  assert.deepEqual(first, repeat);
  const live = await (await call(match)).json();
  assert.equal(live.match.count, 1);
  assert.equal(live.match.result, undefined);
  await action('close');
  await action('score', { homeScore: 3, awayScore: 2 });
  await action('determine');
  await action('publish');
  const published = await (await call(match)).json();
  assert.equal(published.match.status, 'PUBLISHED');
  assert.equal(published.match.result.winner.homeScore, 3);
} finally {
  await call(manage, { method: 'DELETE', cookie: admin, status: 204 });
}
await call(match, { status: 404 });
console.log('PHP voting, duplicate protection, results, QR and deletion passed.');
