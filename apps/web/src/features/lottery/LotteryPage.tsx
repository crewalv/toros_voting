import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage, request } from '../../api';
import { LoginForm } from '../admin/forms';
import './lottery.css';

type Ticket = { sector: string; row: string; seat: string };
type State = { total: number; remaining: number; running: boolean; drawId: string | null; remainingMs: number; winner: Ticket | null; winners: Ticket[] };
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

export function LotteryPage({ admin = false }: { admin?: boolean }) {
  const [state, setState] = useState<State>();
  const [authorized, setAuthorized] = useState<boolean>();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const requestId = useRef<string | undefined>(undefined);
  const parsed = parseTickets(text);

  async function checkLogin() {
    try { await api('/admin/lottery'); setAuthorized(true); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setAuthorized(false); else setError(errorMessage(e)); }
  }
  useEffect(() => { void checkLogin(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        const next = await api<State>('/lottery', { signal: controller.signal });
        setState(next); setError('');
      } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
      if (!controller.signal.aborted) timer = setTimeout(update, 750);
    }
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!state?.running || !video.current) return;
    video.current.currentTime = Math.max(0, (10000 - state.remainingMs) / 1000);
    void video.current.play().catch(() => setError('Нажмите на видео, чтобы разрешить воспроизведение.'));
  }, [state?.drawId, state?.running]);

  async function draw() {
    setBusy(true); setError('');
    requestId.current ??= Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    try {
      setState(await api<State>('/admin/lottery/draw', request('POST', { requestId: requestId.current })));
      requestId.current = undefined;
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  if (admin && authorized === false) return <main className="organizer sign-in-page"><LoginForm onLogin={checkLogin} /></main>;
  if (admin && !authorized) return <main className="message-page">{error || 'Проверяем вход…'}</main>;

  if (admin) return <main className="organizer lottery-admin">
    <h1>Розыгрыш билетов</h1>
    <a className="button" href="/lottery" target="_blank" rel="noreferrer">Открыть экран розыгрыша</a>
    <section className="admin-panel">
      <h2>Список купленных билетов</h2>
      <p>Вставьте три столбца из таблицы — сектор, ряд, место — или по одному билету в строке.</p>
      <label>Билеты<textarea rows={10} value={text} onChange={e => setText(e.target.value)} placeholder={'сектор 1 ряд 5 место 20\nсектор 2 ряд 3 место 40'} /></label>
      <p>Уникальных мест {parsed.tickets.length}</p>
      {parsed.errors.length > 0 && <p role="alert">Проверьте строки {parsed.errors.slice(0, 20).join(', ')}. Заголовок таблицы удалите.</p>}
      <ul>{parsed.tickets.slice(0, 8).map(t => <li key={label(t)}>{label(t)}</li>)}</ul>
      <button className="button primary" disabled={busy || state?.running || !!parsed.errors.length || !parsed.tickets.length || parsed.tickets.length > 10000} onClick={async () => {
        if (state?.total && !confirm('Заменить список и начать новый розыгрыш? История выпавших мест будет очищена.')) return;
        setBusy(true); setError('');
        try { setState(await api<State>('/admin/lottery/import', request('POST', { tickets: parsed.tickets }))); requestId.current = undefined; setMessage('Список сохранён.'); }
        catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
      }}>Сохранить список</button>
      {message && <p role="status">{message}</p>}
    </section>
    <p>Всего {state?.total ?? 0} · осталось {state?.remaining ?? 0}</p>
    <button className="lottery-start" disabled={busy || state?.running || !state?.remaining} onClick={draw}>{state?.running ? 'Розыгрыш идёт…' : state?.winner ? 'Следующий розыгрыш' : 'Начать розыгрыш'}</button>
    {state?.winner && <h2>{label(state.winner)}</h2>}
    {error && <p role="alert">{error}</p>}
    <h2>Выпавшие билеты</h2><ol>{state?.winners.map(t => <li key={label(t)}>{label(t)}</li>)}</ol>
  </main>;

  return <main className="lottery-screen">
    <video ref={video} poster="/lottery-media/poster.jpg" key={state?.running ? 'running' : 'idle'} src={state?.running ? '/lottery-media/running.mp4' : '/lottery-media/idle.mp4'} autoPlay muted playsInline loop={!state?.running} onClick={() => void video.current?.play()} />
    <header><img src="/images/toros.svg" alt="Торос" /></header>
    <div className="lottery-result" aria-live="polite">
      {state?.running ? <h2>Выбираем счастливый билет!</h2> : state?.winner ? <><p>Выигрышный билет</p><h2>{label(state.winner)}</h2></> : <h2>{state?.total ? 'Готовы узнать победителя?' : 'Ожидаем начала розыгрыша'}</h2>}
    </div>
    {authorized && <button className="lottery-start" disabled={busy || state?.running || !state?.remaining} onClick={draw}>{state?.running ? 'Розыгрыш идёт…' : state?.winner ? 'Следующий розыгрыш' : 'Начать розыгрыш'}</button>}
    {error && <p className="lottery-error" role="alert">{error}</p>}
  </main>;
}
