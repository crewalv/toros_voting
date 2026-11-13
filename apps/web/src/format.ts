import type { Match, MatchStatus } from '../../../packages/contracts/src';

export const statusText: Record<MatchStatus, string> = {
  PENDING: 'Ожидает начала', OPEN: 'Приём прогнозов открыт',
  CLOSED: 'Приём прогнозов завершён', PUBLISHED: 'Матч завершён',
};

const zone = 'Asia/Yekaterinburg';
const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: zone });
const clock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: zone });
const exactTime = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZone: zone,
});
export const matchDate = (value: string) => day.format(new Date(value)) + ' · ' + clock.format(new Date(value));
const localInput = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: zone,
});
export const matchLocalInput = (value: string) => localInput.format(new Date(value)).replace(' ', 'T');
export const voteTime = (value: string) => exactTime.format(new Date(value));
export const numberLabel = (number: number) => '№' + String(number).padStart(3, '0');
export const winnerTeam = ({ result, home, away }: Match) =>
  result && (result.homeScore === result.awayScore ? null : result.homeScore > result.awayScore ? home : away);
