import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, CalendarDays, ClipboardList, LogOut, Monitor, Plus, Shield, Users } from 'lucide-react';
import type { Match, Overview, Team } from '../../../../../packages/contracts/src';
import { api, ApiError, errorMessage, request } from '../../api';
import { matchDate, numberLabel, statusText, voteTime } from '../../format';
import { Notice, TeamMark, Teams } from '../../components/match';
import { FormPanel, LoginForm, MatchForm, TeamForm } from './forms';
import { Predictions } from './Predictions';

type Tab = 'matches' | 'teams';

// Workspace layout adapted from shadcn/ui dashboard-01 (MIT).
function ClubBrand() {
  return <div className="workspace-brand">
    <img src="/images/toros.svg" alt="" width="60" height="33" />
    <span><strong>ХК «Торос»</strong><small>Матч-центр</small></span>
  </div>;
}

function MatchBadge({ status }: { status: Match['status'] }) {
  return <span className={'workspace-badge is-' + status.toLowerCase()}>{statusText[status]}</span>;
}

export function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>();
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('matches');
  const [selected, setSelected] = useState<number>();
  const [newMatch, setNewMatch] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>();
  async function refresh() {
    try {
      setOverview(await api<Overview>('/admin/overview'));
      setError('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setOverview(null);
      else setError(errorMessage(cause));
    }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!overview) return;
    const interval = setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
    return () => clearInterval(interval);
  }, [Boolean(overview)]);

  async function logout() {
    try {
      await api('/admin/logout', request('POST'));
      setOverview(null);
      setSelected(undefined);
      setError('');
    } catch (cause) { setError(errorMessage(cause)); }
  }

  if (!overview) return <main className="organizer sign-in-page">
    <div className="sign-in-inner">
      {error && <Notice alert>{error}</Notice>}
      {overview === null ? <LoginForm onLogin={refresh} /> :
        error ? <button className="button" onClick={refresh}>Повторить</button> : <p role="status">Загружаем…</p>}
    </div>
  </main>;

  const active = overview.matches.filter((item) => item.status === 'OPEN');
  const match = overview.matches.find((item) => item.id === selected) ?? active[0] ?? overview.matches[0];
  const home = overview.teams.find((team) => team.name === 'Торос');
  const opponents = overview.teams.filter((team) => team.id !== home?.id);
  return <div className="organizer workspace">
    <aside className="workspace-sidebar">
      <ClubBrand />
      <nav className="workspace-nav" aria-label="Управление конкурсом">
        <button aria-pressed={tab === 'matches'} onClick={() => setTab('matches')}><CalendarDays />Матчи</button>
        <button aria-pressed={tab === 'teams'} onClick={() => setTab('teams')}><Shield />Команды</button>
      </nav>
      <div className="workspace-account">
        <span>{overview.login}</span>
        <button onClick={logout}><LogOut />Выйти</button>
      </div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-header">
        <p>Конкурс прогнозов <span aria-hidden="true">/</span> <strong>{tab === 'matches' ? 'Матчи' : 'Команды'}</strong></p>
      </header>
      <div className="workspace-content">
        {error && <Notice alert>{error}</Notice>}
        <div className="workspace-title">
          <div>
            <h1>{tab === 'matches' ? 'Матчи' : 'Команды'}</h1>
            <p>{tab === 'matches' ? 'Голосование, QR-коды и результаты матчей' : 'Состав участников матчей и эмблемы'}</p>
          </div>
          {tab === 'matches' ? <button className="button primary" onClick={() => setNewMatch(!newMatch)}>
            {!newMatch && <Plus />}{newMatch ? 'Отмена' : 'Создать матч'}
          </button> : <button className="button primary" onClick={() => setEditingTeam(null)}><Plus />Добавить</button>}
        </div>
        {tab === 'matches' ? <>
          <div className="stats">
            <div><span>Всего матчей</span><CalendarDays /><strong>{overview.matches.length}</strong></div>
            <div><span>Голосования открыты</span><Monitor /><strong>{active.length}</strong></div>
            <div><span>Участники</span><Users /><strong>{overview.participants}</strong></div>
            <div><span>Прогнозы</span><ClipboardList /><strong>{overview.matches.reduce((sum, item) => sum + item.count, 0)}</strong></div>
          </div>
          {newMatch ? home && opponents.length ? (
            <MatchForm home={home} opponents={opponents} onSave={async (id) => { setSelected(id); setNewMatch(false); await refresh(); }} />
          ) : <Notice>{home ? 'Сначала добавьте хотя бы одного соперника.' : 'Добавьте «Торос» в справочник команд.'}</Notice>
            : match && <MatchManager key={'manager-' + match.id} match={match} onUpdate={refresh} />}
          <section className="admin-panel match-directory">
            <div className="section-head"><h2>Все матчи</h2></div>
            {overview.matches.length === 0 ? <p className="muted">Добавьте первый матч конкурса.</p> :
              <div className="table-wrap"><table>
                <thead><tr><th scope="col">Матч</th><th scope="col">Начало · UTC+5</th><th scope="col">Статус</th><th scope="col">Прогнозы</th></tr></thead>
                <tbody>{overview.matches.map((item) => <tr key={item.id} className={!newMatch && match?.id === item.id ? 'selected-match' : undefined}>
                  <td><button className="match-row-button" aria-pressed={!newMatch && match?.id === item.id}
                    aria-controls="match-management"
                    onClick={() => {
                      setSelected(item.id);
                      setNewMatch(false);
                      requestAnimationFrame(() => document.getElementById('match-management')?.scrollIntoView({ block: 'nearest' }));
                    }}>
                    <span>{item.home.name} — {item.away.name}</span><ArrowRight />
                  </button>
                    <small className="match-mobile-meta">{matchDate(item.startsAt)} · UTC+5 · {item.count} прогнозов</small>
                    {item.status === 'PUBLISHED' && item.result && <small>{item.result.homeScore}:{item.result.awayScore} · {item.result.winner ? 'Участник ' + numberLabel(item.result.winner.number) : 'Без победителя'}</small>}
                  </td>
                  <td>{matchDate(item.startsAt)}</td><td><MatchBadge status={item.status} /></td><td>{item.count}</td>
                </tr>)}</tbody>
              </table></div>}
          </section>
          {match && !newMatch && <Predictions key={'predictions-' + match.id} match={match} />}
        </> : <div className="admin-grid">
        <section className="admin-panel">
          <div className="section-head"><h2>Список команд</h2></div>
          <ul className="entity-list team-list">{overview.teams.map((team) => <li key={team.id}>
            <button aria-label={'Редактировать «' + team.name + '»'} aria-pressed={editingTeam?.id === team.id} onClick={() => setEditingTeam(team)}>
              <TeamMark team={team} /><span>{team.shortName}</span>
            </button>
          </li>)}</ul>
        </section>
        {editingTeam !== undefined && <TeamForm key={editingTeam?.id ?? 'new'} team={editingTeam ?? undefined} onSave={async () => { setEditingTeam(undefined); await refresh(); }} />}
        </div>}
      </div>
    </main>
  </div>;
}

function MatchManager({ match, onUpdate }: { match: Match; onUpdate: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function action(kind: string, data: Record<string, number> = {}) {
    await api('/admin/matches/' + match.id + '/action', request('POST', { kind, ...data }));
    await onUpdate();
  }
  async function run(kind: string) {
    setError('');
    setBusy(true);
    try { await action(kind); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function deleteMatch() {
    const label = match.home.name + ' — ' + match.away.name;
    if (!window.confirm('Удалить матч «' + label + '» и все его прогнозы? Восстановить их из панели не получится.')) return;
    setError('');
    setBusy(true);
    try {
      await api('/admin/matches/' + match.id, request('DELETE'));
      await onUpdate();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  const result = match.result;
  return <>
    <section className="admin-panel match-manager" id="match-management">
      <div className="section-head"><h2>Управление матчем</h2><MatchBadge status={match.status} /></div>
      <Teams match={match} />
      <p className="muted">{match.tournament} · {matchDate(match.startsAt)} (UTC+5) · {match.count} прогнозов</p>
      {match.description && <p>{match.description}</p>}
      <div className="admin-actions">
        <a className="button" href={'/match/' + match.id} target="_blank" rel="noreferrer"><ArrowUpRight />Страница голосования</a>
        <a className="button" href={'/display/' + match.id} target="_blank" rel="noreferrer"><Monitor />Экран арены</a>
        <a className="button" href={'/api/matches/' + match.id + '/qr?download=1'}><ArrowDownToLine />Скачать QR</a>
        {match.status === 'PENDING' && <button className="button primary" disabled={busy} onClick={() => run('open')}>Начать голосование</button>}
        {match.status === 'OPEN' && <button className="button danger" disabled={busy} onClick={() => run('close')}>Завершить голосование</button>}
        {match.status === 'CLOSED' && result && !result.determined && <button className="button primary" disabled={busy} onClick={() => run('determine')}>Определить победителя</button>}
        <button className="button danger" disabled={busy} onClick={deleteMatch}>Удалить матч</button>
        {match.status === 'CLOSED' && result?.determined && <button className="button primary" disabled={busy} onClick={() => run('publish')}>Опубликовать результаты</button>}
      </div>
      {result && <div className="result-preview">
        <strong>Итоговый счёт {result.homeScore}:{result.awayScore}</strong>
        {result.determined && <p>{result.winner ? 'Победитель: участник ' + numberLabel(result.winner.number) + ' · ' + voteTime(result.winner.createdAt) : 'Никто не угадал точный счёт.'}</p>}
      </div>}
      {error && <Notice alert>{error}</Notice>}
    </section>
    {match.status === 'CLOSED' && <FormPanel title="Итоговый счёт" submitText="Сохранить счёт" onSubmit={async (form) =>
      action('score', { homeScore: Number(form.get('home')), awayScore: Number(form.get('away')) })}>
      <div className="form-columns">
        <label>{match.home.name}<input name="home" type="number" min="0" max="999" step="1" required defaultValue={result?.homeScore} /></label>
        <label>{match.away.name}<input name="away" type="number" min="0" max="999" step="1" required defaultValue={result?.awayScore} /></label>
      </div>
    </FormPanel>}
  </>;
}

