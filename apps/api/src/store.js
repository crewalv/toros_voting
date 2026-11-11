import { PrismaClient } from '@prisma/client';

import { PrismaMariaDb } from '@prisma/adapter-mariadb';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before starting the API.');
const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.set('timezone', '+00:00');
export const db = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl.href) });
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function idFrom(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new HttpError(404, 'Запись не найдена.');
  return id;
}

export const teamFields = { id: true, name: true, shortName: true, logo: true };
const teams = { home: { select: teamFields }, away: { select: teamFields } };
const matchInclude = { ...teams, _count: { select: { predictions: true } }, winner: true };
export const teamView = ({ id, name, shortName, logo }) => ({
  id, name, shortName,
  logo: logo === '/images/toros.png' ? '/images/toros.svg' : logo ?? '/api/teams/' + id + '/logo',
});
const predictionView = ({ homeScore, awayScore, createdAt }) => ({ homeScore, awayScore, createdAt });
export function matchView(match, privateView = false) {
  const showResult = privateView || match.status === 'PUBLISHED';
  return {
    id: match.id, status: match.status, tournament: match.tournament, startsAt: match.startsAt,
    description: match.description, home: teamView(match.home), away: teamView(match.away),
    count: match._count.predictions,
    ...(showResult && match.homeScore !== null ? {
      result: {
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        determined: Boolean(match.determinedAt),
        winner: match.winner ? { ...predictionView(match.winner), number: match.winner.participantId } : null,
      },
    } : {}),
  };
}

export async function findMatch(id, client = db) {
  const match = await client.match.findUnique({ where: { id }, include: matchInclude });
  if (!match) throw new HttpError(404, 'Матч не найден.');
  return match;
}

export async function allMatches() {
  const matches = await db.match.findMany({ include: matchInclude, orderBy: { startsAt: 'desc' } });
  return matches.map((match) => matchView(match, true));
}

// One row lock is shared by prediction writes and all organizer transitions.
export function withMatchLock(id, action) {
  return db.$transaction(async (tx) => {
    const [match] = await tx.$queryRaw`SELECT id, status, homeScore, awayScore, determinedAt FROM \`Match\` WHERE id = ${id} FOR UPDATE`;
    if (!match) throw new HttpError(404, 'Матч не найден.');
    return action(tx, match);
  });
}

export async function recordPrediction(matchId, participantId, scores) {
  return withMatchLock(matchId, async (tx, match) => {
    const where = { matchId_participantId: { matchId, participantId } };
    const existing = await tx.prediction.findUnique({ where });
    if (existing) return predictionView(existing);
    if (match.status !== 'OPEN') throw new HttpError(409, 'Приём прогнозов сейчас закрыт.');
    return predictionView(await tx.prediction.create({ data: { matchId, participantId, ...scores } }));
  });
}

export async function transitionMatch(id, action) {
  return withMatchLock(id, async (tx, match) => {
    const where = { id };
    const conflict = () => { throw new HttpError(409, 'Это действие недоступно на текущем этапе.'); };
    switch (action.kind) {
      case 'open':
        if (match.status !== 'PENDING') conflict();
        await tx.match.update({ where, data: { status: 'OPEN', openedAt: new Date() } });
        break;
      case 'close':
        if (match.status !== 'OPEN') conflict();
        await tx.match.update({ where, data: { status: 'CLOSED', closedAt: new Date() } });
        break;
      case 'score':
        if (match.status !== 'CLOSED') conflict();
        await tx.match.update({ where, data: {
          homeScore: action.homeScore, awayScore: action.awayScore,
          determinedAt: null, winnerPredictionId: null,
        } });
        break;
      case 'determine': {
        if (match.status !== 'CLOSED' || match.homeScore === null) conflict();
        const winner = await tx.prediction.findFirst({
          where: { matchId: id, homeScore: match.homeScore, awayScore: match.awayScore },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        await tx.match.update({ where, data: { winnerPredictionId: winner?.id ?? null, determinedAt: new Date() } });
        break;
      }
      case 'publish':
        if (match.status !== 'CLOSED' || !match.determinedAt) conflict();
        await tx.match.update({ where, data: { status: 'PUBLISHED', publishedAt: new Date() } });
        break;
    }
    return matchView(await findMatch(id, tx), true);
  });
}
