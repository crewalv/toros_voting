export type MatchStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'PUBLISHED';

export interface Team {
  id: number;
  name: string;
  shortName: string;
  logo: string;
}

export interface Scores {
  homeScore: number;
  awayScore: number;
}

export interface Prediction extends Scores {
  createdAt: string;
}

export interface Winner extends Prediction {
  number: number;
}

export interface Match {
  id: number;
  status: MatchStatus;
  startsAt: string;
  tournament: string;
  description?: string;
  home: Team;
  away: Team;
  count: number;
  result?: Scores & { determined: boolean; winner: Winner | null };
}

export interface MatchResponse {
  match: Match;
  number?: number;
  prediction?: Prediction | null;
}

export interface Overview {
  login: string;
  matches: Match[];
  teams: Team[];
  participants: number;
}

export interface PredictionsPage {
  rows: (Prediction & { id: number; participantId: number })[];
  next: number | null;
  distribution: (Scores & { count: number })[];
}
