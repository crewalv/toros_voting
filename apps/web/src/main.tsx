import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, errorMessage } from './api';
import { AdminPage } from './features/admin/AdminPage';
import { DisplayPage } from './features/display/DisplayPage';
import { PreviewPage, VotingPage } from './features/voting/VotingPage';
import './styles/app.css';
import './styles/organizer.css';

function HomeRedirect() {
  const [message, setMessage] = useState('Открываем ближайший матч…');

  useEffect(() => {
    let cancelled = false;
    void api<{ id: number }>('/matches/nearest')
      .then(({ id }) => {
        if (!cancelled) window.location.replace('/match/' + id);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(errorMessage(error));
      });
    return () => { cancelled = true; };
  }, []);

  return <main className="message-page">
    <section className="landing-panel">
      <img src="/images/toros.svg" alt="Торос" width="180" height="90" />
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
  if (path === '/') return <HomeRedirect />;
  return <main className="message-page"><p>Страница не найдена.</p></main>;
}

createRoot(document.getElementById('root')!).render(<App />);

