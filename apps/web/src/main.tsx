import { createRoot } from 'react-dom/client';
import { AdminPage } from './features/admin/AdminPage';
import { DisplayPage } from './features/display/DisplayPage';
import { PreviewPage, VotingPage } from './features/voting/VotingPage';
import './styles/app.css';
import './styles/organizer.css';

function App() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const route = /^\/(match|display)\/([1-9]\d*)$/.exec(path);
  if (route) return route[1] === 'match' ? <VotingPage id={Number(route[2])} /> : <DisplayPage id={Number(route[2])} />;
  if (path === '/admin') return <AdminPage />;
  if (path === '/preview') return <PreviewPage />;
  return <main className="message-page">
    <section className="landing-panel">
      <img src="/images/toros.svg" alt="Торос" width="180" height="90" />
      <p className="eyebrow">ХК «Торос»</p>
      <h1>Конкурс прогнозов</h1>
      <p>Сканируйте QR-код на экране арены, чтобы открыть страницу своего матча.</p>
      <div className="admin-actions"><a className="button primary" href="/preview">Посмотреть демо</a><a className="button" href="/admin">Организаторам</a></div>
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);

