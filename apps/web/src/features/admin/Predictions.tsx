import { useEffect, useState } from 'react';
import type { Match, PredictionsPage } from '../../../../../packages/contracts/src';
import { api, errorMessage } from '../../api';
import { numberLabel, voteTime } from '../../format';
import { Notice } from '../../components/match';

export function Predictions({ match }: { match: Match }) {
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState({ number: '', after: 0 });
  const [page, setPage] = useState<PredictionsPage>();
  const [error, setError] = useState('');
  const path = '/admin/matches/' + match.id + '/predictions';
  const query = filter.number ? 'number=' + encodeURIComponent(filter.number) : '';
  useEffect(() => {
    const controller = new AbortController();
    api<PredictionsPage>(path + '?' + [query, filter.after ? 'after=' + filter.after : ''].filter(Boolean).join('&'), { signal: controller.signal })
      .then((next) => { setPage(next); setError(''); })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [path, query, filter, match.count]);

  return <section className="admin-panel">
    <div className="section-head"><h2>Прогнозы</h2><a className="button" href={'/api' + path + '.csv?' + query}>Скачать CSV</a></div>
    <form className="search-form" onSubmit={(event) => { event.preventDefault(); setFilter({ number: input ? String(Number(input)) : '', after: 0 }); }}>
      <label>Номер участника<input value={input} onChange={(event) => setInput(event.target.value)} inputMode="numeric" pattern="[0-9]{1,10}" placeholder="Например, 011" /></label>
      <button className="button">Найти</button>
    </form>
    {error && <Notice alert>{error}</Notice>}
    {!page ? <p>Загружаем прогнозы…</p> : <>
      <div className="table-wrap"><table>
        <thead><tr><th>Участник</th><th>Прогноз</th><th>Время (UTC+5)</th></tr></thead>
        <tbody>{page.rows.length ? page.rows.map((row) => <tr key={row.id}>
          <td>{numberLabel(row.participantId)}</td><td>{row.homeScore}:{row.awayScore}</td><td>{voteTime(row.createdAt)}</td>
        </tr>) : <tr><td colSpan={3}>Прогнозов пока нет.</td></tr>}</tbody>
      </table></div>
      {(page.next || filter.after > 0) && <div className="admin-actions">
        {filter.after > 0 && <button className="button" onClick={() => setFilter({ ...filter, after: 0 })}>В начало</button>}
        {page.next !== null && <button className="button" onClick={() => setFilter({ ...filter, after: page.next ?? 0 })}>Далее</button>}
      </div>}
      {page.distribution.length > 0 && <div className="distribution">
        <h3>Популярные прогнозы</h3>
        <ul>{page.distribution.map((score) => <li key={score.homeScore + ':' + score.awayScore}>
          <strong>{score.homeScore}:{score.awayScore}</strong>
          <meter min={0} max={Math.max(match.count, score.count)} value={score.count} aria-label={'Прогнозов на ' + score.homeScore + ':' + score.awayScore} />
          <span>{score.count}</span>
        </li>)}</ul>
      </div>}
    </>}
  </section>;
}
