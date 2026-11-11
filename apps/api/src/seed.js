import { db } from './store.js';
import { hashPassword } from './security.js';
import vhlTeams from './vhl-teams.json' with { type: 'json' };

const login = process.env.ADMIN_LOGIN?.trim();
const password = process.env.ADMIN_PASSWORD;
if (!login || login.length > 80 || !password || password.length < 12 || password.length > 128) {
  throw new Error('Set ADMIN_LOGIN and ADMIN_PASSWORD (12–128 characters) in .env.');
}

try {
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.admin.upsert({ where: { login }, create: { login, passwordHash }, update: { passwordHash } }),
    db.adminSession.deleteMany({ where: { admin: { login } } }),
    ...vhlTeams.map(({ name, shortName, logo }) => db.team.upsert({
      where: { name },
      create: { name, shortName, logo },
      update: {},
    })),
  ]);
  console.info('Профиль администратора и справочник ВХЛ (%d команд) готовы.', vhlTeams.length);
} finally {
  await db.$disconnect();
}
