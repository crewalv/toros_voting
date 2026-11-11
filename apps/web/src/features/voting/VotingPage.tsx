import { useState } from 'react';
import type { FormEvent } from 'react';
import type { MatchResponse, Prediction, Scores } from '../../../../../packages/contracts/src';
import { api, errorMessage, request, useMatch } from '../../api';
import { matchDate, numberLabel, statusText } from '../../format';
import { Notice, Results, Score, Teams } from '../../components/match';

type SendPrediction = (score: Scores) => Promise<Prediction>;

export function VotingPage({ id }: { id: number }) {
  const { data, error } = useMatch(id);
  if (!data) return <div className="message-page"><Notice alert={Boolean(error)}>{error || 'Загружаем матч…'}</Notice></div>;
  return <VotingPoster data={data} connectionError={error} send={async (scores) => {
    const response = await api<{ prediction: Prediction }>('/matches/' + id + '/predictions', request('POST', scores));
    return response.prediction;
  }} />;
}

const demoMatch: MatchResponse = {
  number: 11,
  match: {
    id: 1, status: 'OPEN', startsAt: '2026-11-21T14:00:00Z', tournament: 'ВХЛ', count: 248,
    home: { id: 1, name: 'Торос', shortName: 'ТОР', logo: '/images/toros.svg' },
    away: { id: 2, name: 'Ижсталь', shortName: 'ИЖС', logo: '/images/izhstal.png' },
  },
};

export function PreviewPage() {
  return <VotingPoster data={demoMatch} preview send={async (scores) => ({ ...scores, createdAt: new Date().toISOString() })} />;
}

function VotingPoster({ data, send, connectionError, preview = false }: {
  data: MatchResponse;
  send: SendPrediction;
  connectionError?: string;
  preview?: boolean;
}) {
  const { match, number } = data;
  const [home, setHome] = useState(preview ? '3' : '');
  const [away, setAway] = useState(preview ? '2' : '');
  const [submitted, setSubmitted] = useState<Prediction>();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const prediction = data.prediction ?? submitted;
  const open = match.status === 'OPEN';
  const published = match.status === 'PUBLISHED';

  async function vote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      setSubmitted(await send({ homeScore: Number(home), awayScore: Number(away) }));
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const scoreInput = (value: string, update: (value: string) => void, name: string) =>
    <input className="score-tile" aria-label={'Счёт команды «' + name + '»'} inputMode="numeric"
      pattern="[0-9]{1,3}" type="text" required maxLength={3} placeholder="0" value={value}
      onChange={(event) => { if (/^[0-9]{0,3}$/.test(event.target.value)) update(event.target.value); }} />;

  return <main className="voting-page">
    <article className="poster" aria-labelledby="vote-title">
      <div className="poster-inner">
        <header className="poster-meta">
          <p className="match-ribbon">{match.tournament} · {matchDate(match.startsAt)}</p>
          <p className={'status-ribbon status-' + match.status.toLowerCase()} aria-live="polite">{statusText[match.status]}</p>
        </header>
        <h1 className="poster-title" id="vote-title">
          {published ? <>Итоги<br />матча</> : <>Угадай<br />итоговый счёт<br />матча!</>}
        </h1>
        <div className="ice-stroke" aria-hidden="true" />
        <Teams match={match} />
        {connectionError && <Notice alert>{connectionError}</Notice>}
        {published ? <Results match={match} /> : prediction ? (
          <section className="prediction-summary" aria-live="polite">
            <Score home={<span className="score-tile">{prediction.homeScore}</span>} away={<span className="score-tile">{prediction.awayScore}</span>} />
            <Notice>Ваш прогноз {prediction.homeScore}:{prediction.awayScore} принят! Ожидайте результатов.</Notice>
          </section>
        ) : open ? (
          <form className="vote-form" onSubmit={vote}>
            <Score home={scoreInput(home, setHome, match.home.name)} away={scoreInput(away, setAway, match.away.name)} />
            {formError && <Notice alert>{formError}</Notice>}
            <button className="vote-button" disabled={busy || !number}>{busy ? 'Отправляем…' : 'Проголосовать'}</button>
          </form>
        ) : <Notice>{match.status === 'PENDING' ? 'Голосование скоро начнётся. Страница обновится автоматически.' : 'Ожидайте объявления результатов.'}</Notice>}
        <footer className="poster-footer">
          {number && <strong>Участник {numberLabel(number)}</strong>}
          <span>С учётом овертайма<br />и буллитов</span>
        </footer>
      </div>
    </article>
  </main>;
}
