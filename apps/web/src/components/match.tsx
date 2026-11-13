import type { ReactNode } from 'react';
import type { Match, Team } from '../../../../packages/contracts/src';
import { numberLabel, voteTime, winnerTeam } from '../format';

export function TeamMark({ team, logoOnly = false }: { team: Team; logoOnly?: boolean }) {
  return <div className="team-mark">
    <div className="team-emblem"><img src={team.logo} alt="" width="160" height="110" /></div>
    {!logoOnly && <strong>{team.name}</strong>}
  </div>;
}

export function Teams({ match, logoOnly }: { match: Match; logoOnly?: boolean }) {
  return <div className="teams"><TeamMark team={match.home} logoOnly={logoOnly} /><TeamMark team={match.away} logoOnly={logoOnly} /></div>;
}

export function Score({ home, away, names }: { home: ReactNode; away: ReactNode; names?: [string, string] }) {
  return <div className="score-grid">
    {names && <>
      <strong className="score-team score-team-home">{names[0]}</strong>
      <strong className="score-team score-team-away">{names[1]}</strong>
    </>}
    {home}<span className="score-colon" aria-hidden="true">:</span>{away}
  </div>;
}

export function Results({ match, showTeamNames = false }: { match: Match; showTeamNames?: boolean }) {
  const result = match.result;
  if (!result) return null;
  const team = winnerTeam(match);
  const winner = result.winner;
  return <section className="results" aria-label="Результаты матча">
    <Score names={showTeamNames ? [match.home.name, match.away.name] : undefined}
      home={<span className="score-tile">{result.homeScore}</span>} away={<span className="score-tile">{result.awayScore}</span>} />
    <p className="team-winner">{team ? 'Победа: ' + team.name : 'Ничья'}</p>
    <div className="winner-card">
      {winner ? <>
        <p className="eyebrow">Победитель конкурса</p>
        <strong>Участник {numberLabel(winner.number)}</strong>
        <p>Первым угадал счёт {winner.homeScore}:{winner.awayScore} · {voteTime(winner.createdAt)}</p>
      </> : <p>Никто не угадал точный счёт матча.</p>}
    </div>
  </section>;
}

export function Notice({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return <p className={'notice' + (alert ? ' notice-error' : '')} role={alert ? 'alert' : 'status'}>{children}</p>;
}
