import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { ZodError } from 'zod';
import { api } from './routes.js';
import { db } from './store.js';

const app = express();
const production = process.env.NODE_ENV === 'production';
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet({
  strictTransportSecurity: production,
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: production ? [] : null } },
}));
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());
app.use('/api', api, (_req, res) => res.status(404).json({ error: 'Адрес не найден.' }));

const dist = resolve('dist');
if (existsSync(resolve(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false }));
  app.get(['/', '/admin', '/match/:id', '/display/:id', '/preview'], (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
app.use((_req, res) => res.status(404).send('Страница не найдена.'));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError) {
    const issue = error.issues.find((item) => item.code === 'custom');
    return res.status(400).json({ error: issue?.message ?? 'Проверьте заполненные поля.' });
  }
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Проверьте файл эмблемы. Максимальный размер — 1 МБ.' });
  if (error.code === 'P2002') return res.status(409).json({ error: 'Запись с такими данными уже существует.' });
  if (error.code === 'P2025') return res.status(404).json({ error: 'Запись не найдена.' });
  if (error.code === 'P2003') return res.status(400).json({ error: 'Выбранная команда не найдена.' });
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error(error);
  res.status(503).json({ error: 'Сервис временно недоступен. Попробуйте ещё раз.' });
});

await db.$connect();
const server = app.listen(Number(process.env.PORT || 3001), process.env.HOST || '0.0.0.0', () => {
  console.info('Toros Voting listening on port %d', server.address().port);
});
const stop = () => server.close(() => db.$disconnect());
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
