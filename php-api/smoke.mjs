import assert from 'node:assert/strict';

const base = process.env.TOROS_TEST_URL ?? 'http://127.0.0.1:8000';
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
const action = (kind, fields, status = 200) =>
  call(manage + '/action', { method: 'POST', cookie: admin, body: { kind, ...fields }, status });
const current = async () => (await (await call('/matches/current-display')).json()).match;
const localMinute = value => new Date(value + 5 * 3600000).toISOString().slice(0, 16);
const deadline = Math.ceil((Date.now() + 12000) / 60000) * 60000;
const scores = { homeScore: 3, awayScore: 2 };
let nextId;

try {
  await call(manage, { method: 'DELETE', status: 401 });
  const qr = await call(match + '/qr');
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await qr.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal((await current()).status, 'PENDING');
  await action('schedule-close', { deadline: '2030-02-30T12:00' }, 400);
  await action('schedule-close', { deadline: localMinute(Date.now() - 60000) }, 400);
  const scheduled = await (await action('schedule-close', { deadline: localMinute(deadline + 60000) })).json();
  assert.equal(new Date(scheduled.votingDeadline).getTime(), deadline + 60000);
  const canceled = await (await action('schedule-close', { deadline: null })).json();
  assert.equal(canceled.votingDeadline, null);
  await action('open');
  await action('schedule-close', { deadline: localMinute(deadline + 60000) });
  await action('schedule-close', { deadline: localMinute(deadline) });
  assert.equal((await current()).status, 'OPEN');
  const voter = session(await call(match + '/session', { method: 'POST' }));
  const vote = async body => (await (await call(match + '/predictions', { method: 'POST', cookie: voter, body })).json()).prediction;
  const first = await vote({ homeScore: 3, awayScore: 2 });
  const repeat = await vote({ homeScore: 9, awayScore: 9 });
  assert.deepEqual(first, repeat);
  const live = await (await call(match)).json();
  assert.equal(live.match.count, 1);
  assert.equal(live.match.result, undefined);
  const lateVoter = session(await call(match + '/session', { method: 'POST' }));
  await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now() + 250)));
  await call(match + '/predictions', { method: 'POST', cookie: lateVoter, body: scores, status: 409 });
  assert.deepEqual(await vote(scores), first);
  await action('schedule-close', { deadline: null }, 409);
  const closed = await current();
  assert.equal(closed.status, 'CLOSED');
  assert.equal(new Date(closed.closedAt).getTime(), deadline);
  assert.equal(closed.count, 1);
  const nearest = async () => (await (await call('/matches/nearest')).json()).id;
  assert.equal(await nearest(), id);
  const closedVoter = await (await call(match, { cookie: voter })).json();
  assert.deepEqual(closedVoter.prediction, first);
  await action('publish', undefined, 409);
  await action('score', scores);
  await action('publish');
  const published = await (await call(match)).json();
  assert.equal(published.match.status, 'PUBLISHED');
  assert.equal(await nearest(), id);
  assert.equal(published.match.result.winner.homeScore, 3);
  assert.equal((await current()).status, 'PUBLISHED');
  ({ id: nextId } = await (await call('/admin/matches', { method: 'POST', cookie: admin, status: 201,
    body: { awayId, startsAt: new Date(Date.now() + 3600000).toISOString(), tournament: 'Next match' } })).json());
  assert.equal((await current()).id, id);
  await call('/admin/matches/' + nextId + '/action', { method: 'POST', cookie: admin, body: { kind: 'open' } });
  assert.equal((await current()).id, nextId);
  assert.equal((await (await call(match + '?display=1')).json()).match.status, 'PUBLISHED');
} finally {
  if (nextId) await call('/admin/matches/' + nextId, { method: 'DELETE', cookie: admin, status: 204 });
  await call(manage, { method: 'DELETE', cookie: admin, status: 204 });
}
await call(match, { status: 404 });
await call('/matches/current-display', { status: 204 });
console.log('Voting deadline, arena match selection, duplicate protection, results, QR and deletion passed.');
