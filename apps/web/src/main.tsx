import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage } from './features/admin/AdminPage';
import { DisplayPage } from './features/display/DisplayPage';
import { PreviewPage, VotingPage } from './features/voting/VotingPage';
import { api, errorMessage } from './api';
import './styles/app.css';
import './styles/organizer.css';

function HomeMatch() {
  const [matchId, setMatchId] = useState<number | null>(null);
  const [message, setMessage] = useState('Ищем ближайший матч…');

  useEffect(() => {
    const controller = new AbortController();
    api<{ id: number | null }>('/matches/nearest', { signal: controller.signal })
      .then(({ id }) => {
        if (controller.signal.aborted) return;
        if (id !== null) setMatchId(id);
        else setMessage('Ближайший матч пока не назначен.');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(errorMessage(error));
      });
    return () => controller.abort();
  }, []);

  if (matchId !== null) return <VotingPage id={matchId} />;

  return <main className="message-page">
    <section className="landing-panel">
      <img src="/images/toros.svg" alt="Торос" width="180" height="90" />
      <p className="eyebrow">ХК «Торос»</p>
      <h1>Конкурс прогнозов</h1>
      <p role="status">{message}</p>
    </section>
  </main>;
}

function App() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const route = /^\/(match|display)\/([1-9]\d*)$/.exec(path);
  if (route) return route[1] === 'match' ? <VotingPage id={Number(route[2])} /> : <DisplayPage id={Number(route[2])} />;
  if (path === '/admin') return <AdminPage />;
  if (path === '/preview') return <PreviewPage />;
  return <HomeMatch />;
}

createRoot(document.getElementById('root')!).render(<App />);

