import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../../api';
import { LoginForm } from '../admin/forms';
import './lottery.css';

type Ticket = { sector: string; row: string; seat: string };
const label = (t: Ticket) => 'Сектор ' + t.sector + ' · Ряд ' + t.row + ' · Место ' + t.seat;

function parseTickets(text: string) {
  const unique = new Map<string, Ticket>();
  const errors: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const match = /^(?:сектор\s*)?(\d{1,5})[\s;,\t]+(?:ряд\s*)?(\d{1,5})[\s;,\t]+(?:место\s*)?(\d{1,5})\s*$/i.exec(line.trim());
    if (!match || match.slice(1).some(n => Number(n) < 1)) { errors.push(index + 1); return; }
    const [sector, row, seat] = match.slice(1).map(n => String(Number(n)));
    unique.set([sector, row, seat].join(':'), { sector, row, seat });
  });
  return { tickets: [...unique.values()], errors };
}

function randomIndex(length: number) {
  const values = new Uint32Array(1);
  const limit = 4294967296 - (4294967296 % length);
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % length;
}

function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function LotteryPage({ admin = false }: { admin?: boolean }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const pool = useRef<Ticket[]>([]);
  const [winner, setWinner] = useState<Ticket>();
  const [running, setRunning] = useState(false);
  const drawing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [authorized, setAuthorized] = useState<boolean>();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const parsed = parseTickets(text);

  async function checkLogin() {
    try { await api('/admin/lottery'); setAuthorized(true); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setAuthorized(false); else setError(errorMessage(e)); }
  }
  useEffect(() => {
    void checkLogin();
    return () => clearTimeout(timer.current);
  }, []);

  async function draw() {
    if (drawing.current || !tickets.length) return;
    drawing.current = true;
    setError('');
    try {
      await api('/admin/lottery');
      if (!pool.current.length) pool.current = [...tickets];
      let candidates = pool.current;
      if (winner && candidates.length > 1) candidates = candidates.filter(t => label(t) !== label(winner));
      const selected = candidates[randomIndex(candidates.length)];
      pool.current = pool.current.filter(t => t !== selected);
      setRunning(true);
      timer.current = setTimeout(() => {
        setWinner(selected);
        setRunning(false);
        drawing.current = false;
      }, 5000);
    } catch (e) {
      drawing.current = false;
      if (e instanceof ApiError && e.status === 401) setAuthorized(false);
      setError(errorMessage(e));
    }
  }
  if (admin && authorized === false) return <main className="organizer sign-in-page"><LoginForm onLogin={checkLogin} /></main>;
  if (admin && !authorized) return <main className="message-page">{error || 'Проверяем вход…'}</main>;

  if (admin) return <main className="organizer lottery-admin">
    <h1>Розыгрыш билетов</h1>
    <button className="button" onClick={() => navigate('/lottery')}>Открыть экран розыгрыша</button>
    <section className="admin-panel">
      <h2>Список купленных билетов</h2>
      <label>Билеты<textarea rows={10} value={text} onChange={e => setText(e.target.value)} /></label>
      <p>Уникальных мест {parsed.tickets.length}</p>
      {parsed.errors.length > 0 && <p role="alert">Проверьте строки {parsed.errors.slice(0, 20).join(', ')}. Заголовок таблицы удалите.</p>}
      <ul>{parsed.tickets.slice(0, 8).map(t => <li key={label(t)}>{label(t)}</li>)}</ul>
      <button className="button primary" disabled={running || !!parsed.errors.length || !parsed.tickets.length || parsed.tickets.length > 10000} onClick={() => {
        if (tickets.length && !confirm('Заменить текущий список билетов?')) return;
        pool.current = [...parsed.tickets];
        setTickets(parsed.tickets);
        setWinner(undefined);
        setError('');
        setMessage('Билеты готовы к розыгрышу.');
      }}>Подготовить билеты</button>
      {message && <p role="status">{message}</p>}
    </section>
    <p>Всего {tickets.length} · осталось в круге {pool.current.length || tickets.length}</p>
    <p>Билеты действуют в этой вкладке до её обновления или закрытия.</p>
    {error && <p role="alert">{error}</p>}
  </main>;

  return <main className="lottery-screen">
    <video ref={video} poster="/lottery-media/poster.jpg" key={running ? 'running' : 'idle'} src={running ? '/lottery-media/running.mp4' : '/lottery-media/idle.mp4'} autoPlay muted playsInline loop={!running} onClick={() => void video.current?.play()} />
    <header><img src="/images/toros.svg" alt="Торос" /></header>
    {winner && !running && <div className="lottery-result" aria-live="polite">
      <p>Выигрышный билет</p><h2>{label(winner)}</h2>
    </div>}
    {authorized && !running && <button className="lottery-start" disabled={!tickets.length} onClick={draw}>Начать розыгрыш</button>}
    {authorized && !tickets.length && <button className="button" onClick={() => navigate('/admin2')}>Загрузить билеты</button>}
    {error && <p className="lottery-error" role="alert">{error}</p>}
  </main>;
}
