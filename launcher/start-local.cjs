const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
process.chdir(path.resolve(__dirname, '..'));
const children = [];
let closing = false;
function close() { if (closing) return; closing = true; for (const p of children) if (!p.killed) p.kill(); }
process.on('SIGINT', () => { close(); process.exit(0); });
process.on('SIGTERM', () => { close(); process.exit(0); });
process.on('exit', close);
function free(port) { return new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); }); }
function get(url) { return new Promise(resolve => { const req = http.get(url, { timeout: 1500 }, r => { let body = ''; r.on('data', c => body += c); r.on('end', () => resolve({status: r.statusCode, body})); }); req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null)); }); }
function start(args, name) { const p = spawn(process.execPath, args, { cwd: process.cwd(), stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3001' } }); children.push(p); p.on('error', e => console.error(`Ошибка запуска ${name}: ${e.message}`)); return p; }
async function ready(url, test, child) { for (let i = 0; i < 40; i++) { if (child.exitCode !== null) return false; const result = await get(url); if (result && test(result)) return true; await new Promise(r => setTimeout(r, 500)); } return false; }
(async () => {
 console.log('\nПроверка программы «Торос»...');
 if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 12)) throw Error('Нужен Node.js версии 22.12 или новее.');
 if (!fs.existsSync('.env')) throw Error('Не найден файл .env с настройками базы и администратора.');
 if (!fs.existsSync('node_modules/vite/bin/vite.js') || !fs.existsSync('node_modules/@prisma/client')) throw Error('Не установлены зависимости проекта. В папке проекта выполните npm ci.');
 for (const port of [3001, 5173]) if (!await free(port)) throw Error(`Порт ${port} уже занят. Возможно, программа уже запущена в другом окне. Закройте прежний запуск и попробуйте снова.`);
 console.log('Запуск сервера и проверка базы данных...');
 const api = start(['--env-file-if-exists=.env', 'apps/api/src/server.js'], 'сервера');
 if (!await ready('http://127.0.0.1:3001/api/health', r => { try { return r.status === 200 && JSON.parse(r.body).ok === true; } catch { return false; } }, api)) throw Error('Сервер или база данных недоступны. Проверьте службу MySQL и настройки .env.');
 console.log('Запуск сайта...');
 const vite = start(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'сайта');
 if (!await ready('http://127.0.0.1:5173/', r => r.status === 200 && r.body.includes('/src/main.tsx'), vite)) throw Error('Не удалось запустить страницу сайта.');
 console.log('\nГотово! Откройте в браузере:\nПанель организатора: http://localhost:5173/admin\nДемонстрация:        http://localhost:5173/preview\nГлавная страница:    http://localhost:5173/\n\nДержите это окно открытым. Для остановки нажмите Ctrl+C.');
 for (const p of children) p.once('exit', code => { if (!closing) { console.error(`\nОдна из частей программы остановилась (код ${code}).`); close(); process.exitCode = 1; } });
})().catch(e => { console.error('\n' + e.message); close(); process.exitCode = 1; });
