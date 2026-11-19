import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage, request } from '../../api';
import { LoginForm } from '../admin/forms';
import './lottery.css';

type Lottery = { total: number; remaining: number; drawId: string; remainingMs: number; winner: string | null; tickets?: string[] };
const missingMedia = 'Файлы анимации недоступны. Загрузите папку lottery-media из архива в php-api/public.';

function parseTickets(text: string) {
  const unique = new Set<string>();
  for (const raw of text.split(/\r\n|[\n\r\u2028\u2029]/)) {
    const line = raw.trim();
    if (!line || /^сектор\s+ряд\s+место$/i.test(line)) continue;
    const match = /^(?:сектор\s*)?(\d{1,5})[\s;,\t]+(?:ряд\s*)?(\d{1,5})[\s;,\t]+(?:место\s*)?(\d{1,5})\s*$/i.exec(line);
    unique.add(match ? `Сектор ${Number(match[1])} · Ряд ${Number(match[2])} · Место ${Number(match[3])}` : line.replace(/[^\S\t]*\t[^\S\t]*/g, ' · ').replace(/\s+/g, ' '));
  }
  return [...unique];
}

function navigate(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function LotteryPage({ admin = false }: { admin?: boolean }) {
  const [state, setState] = useState<Lottery>();
  const [running, setRunning] = useState(false);
  const [authorized, setAuthorized] = useState<boolean>();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const until = useRef(0);
  const locked = useRef(false);
  const mutation = useRef(0);
  const hydrated = useRef(false);
  const parsed = parseTickets(text);

  function accept(next: Lottery) {
    setState(next);
    until.current = performance.now() + next.remainingMs;
    setRunning(next.remainingMs > 0);
  }

  async function checkLogin() {
    try {
      const next = await api<Lottery>('/admin/lottery');
      setAuthorized(true);
      if (!hydrated.current) { setText((next.tickets ?? []).join('\n')); hydrated.current = true; }
      accept(next);
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthorized(false);
      else setError(errorMessage(e));
    }
  }

  useEffect(() => { void checkLogin(); }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      const version = mutation.current;
      try {
        const next = await api<Lottery>('/lottery');
        if (!stopped && !locked.current && version === mutation.current) { accept(next); setError(''); }
      } catch (e) { if (!stopped) setError(errorMessage(e)); }
      if (!stopped) timer = setTimeout(update, 750);
    }
    void update();
    const tick = setInterval(() => {
      if (until.current && performance.now() >= until.current) setRunning(false);
    }, 100);
    return () => { stopped = true; clearTimeout(timer); clearInterval(tick); };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || admin) return;
    setMediaError('');
    element.load();
    if (!running && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void element.play().catch(e => {
      if (e.name !== 'AbortError') setMediaError(element.error || e.name === 'NotSupportedError' ? missingMedia : 'Видео не запустилось. Нажмите «Включить анимацию».');
    });
  }, [running, admin]);

  async function change(kind: 'tickets' | 'draw') {
    if (locked.current) return;
    if (kind === 'tickets' && state?.total && !confirm('Заменить список? Старые билеты и результат будут удалены.')) return;
    locked.current = true;
    mutation.current++;
    setBusy(true);
    setError('');
    try {
      const next = await api<Lottery>('/admin/lottery/' + kind, request('POST', kind === 'tickets' ? { text } : {}));
      accept(next);
      if (kind === 'tickets') {
        setText((next.tickets ?? []).join('\n'));
        setMessage('Новый список сохранён. Старые билеты и результат удалены.');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthorized(false);
      setError(errorMessage(e));
    } finally { locked.current = false; setBusy(false); mutation.current++; }
  }

  if (admin && authorized === false) return <main className="organizer sign-in-page"><LoginForm onLogin={checkLogin} /></main>;
  if (admin && !authorized) return <main className="message-page">{error || 'Проверяем вход…'}</main>;
  if (admin) return <main className="organizer lottery-admin">
    <h1>Розыгрыш билетов</h1>
    <button className="button" onClick={() => navigate('/lottery')}>Открыть экран розыгрыша</button>
    <section className="admin-panel">
      <h2>Список купленных билетов</h2>
      <label>Билеты<textarea rows={10} value={text} onChange={e => { setText(e.target.value); setMessage(''); }} /></label>
      <p>Одна строка — один билет. Можно вставить номера, текст или строки из Excel.</p>
      <p>Уникальных билетов {parsed.length}</p>
      <ul>{parsed.slice(0, 8).map(t => <li key={t}>{t}</li>)}</ul>
      <button className="button primary" disabled={busy || running || !parsed.length || parsed.length > 10000 || parsed.some(t => t.length > 500)} onClick={() => void change('tickets')}>Сохранить билеты</button>
      {message && <p role="status">{message}</p>}
    </section>
    <p>Сохранено {state?.total ?? 0} · осталось в круге {state?.remaining ?? 0}</p>
    <p>Билеты сохраняются после закрытия страницы. Новый список заменяет старый.</p>
    {error && <p role="alert">{error}</p>}
  </main>;

  return <main className="lottery-screen">
    <video ref={video} poster="/lottery-media/poster.jpg" src={running ? '/lottery-media/running.mp4' : '/lottery-media/idle.mp4'} muted playsInline preload="auto" loop={!running} onError={() => setMediaError(missingMedia)} />
    <header><img src="/images/toros.svg" alt="Торос" /></header>
    {state?.winner && !running && <div className="lottery-result" aria-live="polite">
      <p>Выигрышный билет</p><h2>{state.winner}</h2>
    </div>}
    {authorized && !running && <button className="lottery-start" disabled={busy || !state?.total} onClick={() => void change('draw')}>Начать розыгрыш</button>}
    {authorized && !state?.total && <button className="button" onClick={() => navigate('/admin2')}>Загрузить билеты</button>}
    {mediaError && <div className="lottery-error" role="alert">{mediaError} <button className="button" onClick={() => {
      const element = video.current;
      if (!element) return;
      element.load();
      void element.play().then(() => setMediaError('')).catch(() => setMediaError('Не удалось загрузить видео. Проверьте папку lottery-media на сервере.'));
    }}>Включить анимацию</button></div>}
    {error && <p className="lottery-error" role="alert">{error}</p>}
  </main>;
}
