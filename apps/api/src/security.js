import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const newToken = () => randomBytes(32).toString('hex');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const validToken = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return salt + ':' + key.toString('hex');
}

export async function checkPassword(password, storedHash) {
  const [salt, hash] = (storedHash ?? ('0'.repeat(32) + ':' + '0'.repeat(128))).split(':');
  const key = await derive(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hash, 'hex')) && Boolean(storedHash);
}
