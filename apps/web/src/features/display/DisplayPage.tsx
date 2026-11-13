import { useMatch } from '../../api';
import { matchDate, statusText } from '../../format';
import { Notice, Results, Teams } from '../../components/match';

export function DisplayPage({ id }: { id?: number }) {
  const { data, error } = useMatch(id, true);
  if (!data) return <div className="message-page"><Notice alert={Boolean(error)}>{error || (data === null ? 'Матчи пока не назначены.' : 'Загружаем матч…')}</Notice></div>;
  const { match } = data;
  const published = match.status === 'PUBLISHED';
  const showQR = match.status === 'PENDING' || match.status === 'OPEN';
  return <main className={'display-page' + (published ? ' display-published' : showQR ? ' display-live' : '')}>
    <header className="display-header">
      <p className="match-ribbon">{match.tournament} · {matchDate(match.startsAt)}</p>
      <p className={'status-ribbon status-' + match.status.toLowerCase()}>{statusText[match.status]}</p>
    </header>
    <h1>{published ? 'Итоги матча' : match.status === 'CLOSED' ? 'Ожидаем итоги' : 'Угадай счёт матча!'}</h1>
    <div className="ice-stroke" aria-hidden="true" />
    <div className={'display-content' + (showQR ? ' display-with-qr' : '')}>
      <Teams match={match} />
      {published && <Results match={match} />}
      {showQR && <aside className="display-qr">
        <img src={'/api/matches/' + match.id + '/qr'} alt="QR-код страницы голосования" width="640" height="640" />
        <p>Сканируй QR-код<br />и отправляй прогноз</p>
      </aside>}
    </div>
    <footer className="display-footer"><strong>{match.count.toLocaleString('ru-RU')}</strong> · принято прогнозов</footer>
    {error && <Notice alert>{error}</Notice>}
  </main>;
}
