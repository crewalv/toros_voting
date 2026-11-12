import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import QRCode from 'qrcode';
import { allMatches, db, findMatch, HttpError, idFrom, matchView, recordPrediction, teamFields, teamView, transitionMatch, withMatchLock } from './store.js';
import { checkPassword, hashToken, newToken, validToken } from './security.js';

const api = Router();
const production = process.env.NODE_ENV === 'production';
const origin = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : null;
if (production && !origin?.startsWith('https://')) throw new Error('PUBLIC_BASE_URL must be HTTPS in production.');

const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict', path: '/' };
const participantCookie = production ? '__Host-toros-voter' : 'toros-voter';
const adminCookie = production ? '__Host-toros-admin' : 'toros-admin';
const sessionDuration = 8 * 60 * 60 * 1000;
const scoreFields = { homeScore: z.int().min(0).max(999), awayScore: z.int().min(0).max(999) };
const scores = z.object(scoreFields);
function arenaLimit(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive integer.');
  return value;
}
const limit = (max, windowMs) => rateLimit({
  limit: max, windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте немного позже.' },
});

api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (req.get('X-Toros-Request') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site')) {
    throw new HttpError(403, 'Запрос отклонён.');
  }
  next();
});

async function participant(req) {
  const token = req.cookies[participantCookie];
  if (!validToken(token)) return null;
  return db.participant.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } });
}

api.get('/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

api.get('/matches/nearest', async (_req, res) => {
  const match = await db.match.findFirst({
    where: { status: 'OPEN' }, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], select: { id: true },
  }) ?? await db.match.findFirst({
    where: { status: 'PENDING', startsAt: { gte: new Date() } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true },
  }) ?? await db.match.findFirst({
    where: { status: 'PENDING' }, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], select: { id: true },
  });
  res.json({ id: match?.id ?? null });
});

api.post('/matches/:id/session', limit(arenaLimit('SESSION_REQUESTS_PER_MINUTE', 2000), 60_000), async (req, res) => {
  const id = idFrom(req.params.id);
  if (!await db.match.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(404, 'Матч не найден.');
  let voter = await participant(req);
  if (!voter) {
    const token = newToken();
    voter = await db.participant.create({ data: { tokenHash: hashToken(token) }, select: { id: true } });
    res.cookie(participantCookie, token, { ...cookieOptions, sameSite: 'lax', maxAge: 365 * 86400000 });
  }
  res.json({ number: voter.id });
});

api.get('/matches/:id', async (req, res) => {
  const id = idFrom(req.params.id);
  const match = await findMatch(id);
  if (req.query.display === '1') return res.json({ match: matchView(match) });

  const voter = await participant(req);
  const prediction = voter ? await db.prediction.findUnique({
    where: { matchId_participantId: { matchId: id, participantId: voter.id } },
    select: { homeScore: true, awayScore: true, createdAt: true },
  }) : null;
  res.json({ match: matchView(match), number: voter?.id, prediction });
});

api.post('/matches/:id/predictions', limit(arenaLimit('VOTE_REQUESTS_PER_MINUTE', 4000), 60_000), async (req, res) => {
  const voter = await participant(req);
  if (!voter) throw new HttpError(409, 'Не удалось найти участника. Обновите страницу.');
  const prediction = await recordPrediction(idFrom(req.params.id), voter.id, scores.parse(req.body));
  res.json({ prediction });
});

api.get('/matches/:id/qr', async (req, res) => {
  const { id } = await findMatch(idFrom(req.params.id));
  const base = origin ?? (req.protocol + '://' + req.get('host'));
  const png = await QRCode.toBuffer(new URL('/match/' + id, base).href, { width: 640, margin: 4 });
  res.type('png').set('Cache-Control', 'public, max-age=3600');
  if (req.query.download === '1') res.attachment('toros-match-' + id + '.png');
  res.send(png);
});

api.get('/teams/:id/logo', async (req, res) => {
  const team = await db.team.findUnique({
    where: { id: idFrom(req.params.id) }, select: { logoBytes: true, logoType: true },
  });
  if (!team?.logoBytes || !team.logoType) throw new HttpError(404, 'Эмблема не найдена.');
  res.type(team.logoType).send(Buffer.from(team.logoBytes));
});

api.post('/admin/login', limit(10, 15 * 60_000), async (req, res) => {
  const { login, password } = z.object({
    login: z.string().trim().min(1).max(80), password: z.string().min(1).max(128),
  }).parse(req.body);
  const admin = await db.admin.findUnique({ where: { login } });
  if (!await checkPassword(password, admin?.passwordHash)) throw new HttpError(401, 'Неверный логин или пароль.');
  const token = newToken();
  await db.$transaction([
    db.adminSession.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
    db.adminSession.create({ data: { tokenHash: hashToken(token), adminId: admin.id, expiresAt: new Date(Date.now() + sessionDuration) } }),
  ]);
  res.cookie(adminCookie, token, { ...cookieOptions, maxAge: sessionDuration }).json({ login: admin.login });
});

api.use('/admin', async (req, _res, next) => {
  const token = req.cookies[adminCookie];
  if (!validToken(token)) throw new HttpError(401, 'Войдите в панель организатора.');
  const tokenHash = hashToken(token);
  const session = await db.adminSession.findUnique({ where: { tokenHash }, include: { admin: { select: { login: true } } } });
  if (!session || session.expiresAt <= new Date()) throw new HttpError(401, 'Войдите в панель организатора.');
  req.adminSession = session;
  next();
});

api.post('/admin/logout', async (req, res) => {
  await db.adminSession.deleteMany({ where: { tokenHash: req.adminSession.tokenHash } });
  res.clearCookie(adminCookie, cookieOptions).sendStatus(204);
});

api.get('/admin/overview', async (req, res) => {
  const [matches, teams, participants] = await Promise.all([
    allMatches(), db.team.findMany({ select: teamFields, orderBy: { name: 'asc' } }), db.participant.count(),
  ]);
  res.json({ login: req.adminSession.admin.login, matches, teams: teams.map(teamView), participants });
});

const upload = multer({ limits: { fileSize: 1024 * 1024, fields: 2, files: 1, fieldSize: 512 } });
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new HttpError(400, 'Загрузите эмблему PNG, JPEG или WebP.');
}
async function saveTeam(req, res) {
  const details = z.object({
    name: z.string().trim().min(1).max(80), shortName: z.string().trim().min(1).max(12),
  }).parse(req.body);
  const id = req.params.id ? idFrom(req.params.id) : null;
  if (id && details.name !== 'Торос') {
    const team = await db.team.findUnique({ where: { id }, select: { name: true } });
    if (team?.name === 'Торос') throw new HttpError(400, 'Название домашней команды «Торос» закреплено.');
  }
  const file = req.file;
  if (!id && !file) throw new HttpError(400, 'Добавьте эмблему команды.');
  const data = { ...details, ...(file ? { logo: null, logoType: imageType(file.buffer), logoBytes: file.buffer } : {}) };
  const team = id ? await db.team.update({ where: { id }, data, select: teamFields })
    : await db.team.create({ data, select: teamFields });
  res.status(id ? 200 : 201).json(teamView(team));
}
api.post('/admin/teams', upload.single('logo'), saveTeam);
api.put('/admin/teams/:id', upload.single('logo'), saveTeam);
api.post('/admin/teams/:id', upload.single('logo'), saveTeam);

api.post('/admin/matches', async (req, res) => {
  const data = z.object({
    awayId: z.int().positive().max(2147483647),
    tournament: z.string().trim().min(1).max(80),
    startsAt: z.iso.datetime({ offset: true }), description: z.string().trim().max(600).optional(),
  }).parse(req.body);
  const home = await db.team.findUnique({ where: { name: 'Торос' }, select: { id: true } });
  if (!home) throw new HttpError(409, 'Добавьте «Торос» в справочник команд.');
  if (home.id === data.awayId) throw new HttpError(400, 'Выберите соперника «Тороса».');
  const match = await db.match.create({
    data: { ...data, homeId: home.id, startsAt: new Date(data.startsAt) },
    select: { id: true },
  });
  res.status(201).json(match);
});

api.delete('/admin/matches/:id', async (req, res) => {
  const id = idFrom(req.params.id);
  await withMatchLock(id, async (tx) => {
    await tx.match.update({ where: { id }, data: { winnerPredictionId: null } });
    await tx.prediction.deleteMany({ where: { matchId: id } });
    await tx.match.delete({ where: { id } });
  });
  res.sendStatus(204);
});

const matchAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open') }), z.object({ kind: z.literal('close') }),
  z.object({ kind: z.literal('score'), ...scoreFields }), z.object({ kind: z.literal('determine') }),
  z.object({ kind: z.literal('publish') }),
]);
api.post('/admin/matches/:id/action', async (req, res) => {
  res.json(await transitionMatch(idFrom(req.params.id), matchAction.parse(req.body)));
});

const predictionFields = { id: true, participantId: true, homeScore: true, awayScore: true, createdAt: true };
const numberQuery = z.string().regex(/^[0-9]{1,10}$/).transform(Number).pipe(z.int().positive().max(2147483647));
const predictionWhere = (matchId, query) => ({
  matchId, ...(query ? { participantId: numberQuery.parse(query) } : {}),
});

api.get('/admin/matches/:id/predictions', async (req, res) => {
  const matchId = idFrom(req.params.id);
  const where = predictionWhere(matchId, req.query.number);
  const after = req.query.after ? idFrom(req.query.after) : 0;
  const [rows, distribution] = await Promise.all([
    db.prediction.findMany({ where: { ...where, id: { gt: after } }, select: predictionFields, orderBy: { id: 'asc' }, take: 51 }),
    db.prediction.groupBy({
      by: ['homeScore', 'awayScore'], where: { matchId }, _count: { _all: true },
      orderBy: { _count: { homeScore: 'desc' } }, take: 12,
    }),
  ]);
  res.json({
    rows: rows.slice(0, 50),
    next: rows.length > 50 ? rows[49].id : null,
    distribution: distribution.map(({ homeScore, awayScore, _count }) => ({ homeScore, awayScore, count: _count._all })),
  });
});

api.get('/admin/matches/:id/predictions.csv', async (req, res) => {
  const matchId = idFrom(req.params.id);
  await findMatch(matchId);
  const where = predictionWhere(matchId, req.query.number);
  res.attachment('toros-match-' + matchId + '.csv').type('text/csv');
  res.write('\uFEFFУчастник;Торос/хозяева;Гости;Время (UTC)\r\n');
  let after = 0;
  while (!res.destroyed) {
    const rows = await db.prediction.findMany({
      where: { ...where, id: { gt: after } }, select: predictionFields, orderBy: { id: 'asc' }, take: 500,
    });
    if (!rows.length || res.destroyed) break;
    const csv = rows.map((row) => [row.participantId, row.homeScore, row.awayScore, row.createdAt.toISOString()].join(';')).join('\r\n');
    if (!res.write(csv + '\r\n')) {
      await new Promise((resolve) => {
        const ready = () => { res.off('drain', ready); res.off('close', ready); resolve(); };
        res.once('drain', ready);
        res.once('close', ready);
      });
    }
    after = rows.at(-1).id;
  }
  res.end();
});

export { api };
