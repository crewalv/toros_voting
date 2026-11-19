// Run only against a local disposable database: replaces the lottery list.
import assert from 'node:assert/strict';
const base = process.env.LOTTERY_TEST_URL ?? 'http://127.0.0.1:8000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
let cookie = '';
async function call(path, method = 'GET', data, auth = true) {
  const response = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type':'application/json', 'X-Toros-Request':'1', ...(auth ? {cookie} : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: response.status, data: await response.json() };
}
const login = await call('/admin/login', 'POST', {login:process.env.ADMIN_LOGIN ?? 'organizer', password:process.env.ADMIN_PASSWORD});
assert.equal(login.status, 200);
assert.equal((await call('/admin/lottery/tickets', 'POST', {text:'x'}, false)).status, 401);
assert.equal((await call('/admin/lottery/draw', 'POST', {}, false)).status, 401);
const input = '00123\nАнна Петрова\nсектор 1 ряд 5 место 20\n2\t3\t40\n00123\n<script>alert(1)</script>';
const saved = await call('/admin/lottery/tickets', 'POST', {text: input});
assert.equal(saved.status, 200);
assert.equal(saved.data.total, 5);
assert.equal(saved.data.tickets[0], '00123');
assert.equal(saved.data.tickets[3], 'Сектор 2 · Ряд 3 · Место 40');
assert.deepEqual((await call('/admin/lottery')).data.tickets, saved.data.tickets);
assert.equal('tickets' in (await call('/lottery', 'GET', undefined, false)).data, false);
assert.equal((await call('/admin/lottery/tickets','POST',{text:'\n'})).status,400);
assert.equal((await call('/admin/lottery/tickets','POST',{text:'x'.repeat(501)})).status,400);
assert.equal((await call('/admin/lottery')).data.total,5);
await call('/admin/lottery/tickets', 'POST', {text:'A\nB'});
let previous;
for (let i=0; i<3; i++) {
  const concurrent = await Promise.all([call('/admin/lottery/draw','POST',{}),call('/admin/lottery/draw','POST',{})]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
  const draw = concurrent.find(x=>x.status===200).data;
  assert.equal(draw.winner,null);
  assert.ok(draw.remainingMs>0 && draw.remainingMs<=5000);
  assert.equal((await call('/lottery', 'GET', undefined, false)).data.winner,null);
  assert.equal((await call('/admin/lottery/tickets','POST',{text:'replacement'})).status,409);
  await new Promise(resolve=>setTimeout(resolve,5100));
  const result = (await call('/lottery','GET',undefined,false)).data;
  assert.ok(['A','B'].includes(result.winner));
  assert.notEqual(previous,result.winner);
  previous=result.winner;
}
const replacement = await call('/admin/lottery/tickets','POST',{text:'Новый билет'});
assert.deepEqual(replacement.data.tickets,['Новый билет']);
assert.equal(replacement.data.winner,null);
assert.equal(replacement.data.remaining,1);
const reloaded = (await call('/admin/lottery')).data;
assert.deepEqual(reloaded.tickets,['Новый билет']);
assert.equal(reloaded.winner,null);
console.log('Lottery: flexible import, persistence, auth, hidden result, concurrency, five seconds, rounds and replacement passed.');
