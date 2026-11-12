import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Team } from '../../../../../packages/contracts/src';
import { api, errorMessage, request } from '../../api';
import { Notice } from '../../components/match';

export function FormPanel({ title, children, submitText, onSubmit, login = false }: {
  title: string; children: ReactNode; submitText: string;
  onSubmit: (data: FormData) => Promise<void>;
  login?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await onSubmit(data);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return <form className={login ? 'sign-in-form' : 'admin-panel form-panel'} onSubmit={submit}>
    {login ? <div className="sign-in-intro">
      <img src="/images/toros-inverse.svg" alt="ХК «Торос»" width="112" height="61" />
      <h1>{title}</h1>
      <p>Вход для организаторов</p>
    </div> : <h2>{title}</h2>}
    {children}
    {error && <Notice alert>{error}</Notice>}
    <button className="button primary" disabled={busy}>{busy ? (login ? 'Входим…' : 'Сохраняем…') : submitText}</button>
  </form>;
}

export function LoginForm({ onLogin }: { onLogin: () => Promise<void> }) {
  return <FormPanel title="Матч-центр" submitText="Войти" login onSubmit={async (data) => {
    await api('/admin/login', request('POST', Object.fromEntries(data)));
    await onLogin();
  }}>
    <label>Логин<input name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={80} required /></label>
    <label>Пароль<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
  </FormPanel>;
}

export function TeamForm({ team, onSave }: { team?: Team; onSave: () => Promise<void> }) {
  return <FormPanel title={team ? 'Редактирование команды' : 'Новая команда'} submitText="Сохранить команду" onSubmit={async (data) => {
    const logo = data.get('logo');
    if (logo instanceof File && !logo.size) data.delete('logo');
    await api('/admin/teams' + (team ? '/' + team.id : ''), request('POST', data));
    await onSave();
  }}>
    <label>Название<input name="name" required maxLength={80} defaultValue={team?.name} readOnly={team?.name === 'Торос'} /></label>
    <label>Краткое обозначение<input name="shortName" required maxLength={12} defaultValue={team?.shortName} /></label>
    <label>Эмблема<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" required={!team} /></label>
    <small>PNG, JPEG или WebP, до 1 МБ.</small>
  </FormPanel>;
}

export function MatchForm({ home, opponents, onSave }: { home: Team; opponents: Team[]; onSave: (id: number) => Promise<void> }) {
  return <FormPanel title="Новый матч" submitText="Создать матч" onSubmit={async (data) => {
    const { id } = await api<{ id: number }>('/admin/matches', request('POST', {
      awayId: Number(data.get('awayId')),
      startsAt: data.get('startsAt') + ':00+05:00', tournament: data.get('tournament'), description: data.get('description'),
    }));
    await onSave(id);
  }}>
    <p className="muted">Домашняя команда — <strong>{home.name}</strong></p>
    <label>Соперник<select name="awayId" required defaultValue="">
      <option value="" disabled>Выберите соперника</option>
      {opponents.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
    </select></label>
    <div className="form-columns">
      <label>Начало матча (UTC+5)<input name="startsAt" type="datetime-local" required /></label>
      <label>Турнир<input name="tournament" maxLength={80} defaultValue="ВХЛ" required /></label>
    </div>
    <label>Описание<textarea name="description" maxLength={600} rows={2} /></label>
    <small>В конкурсе учитывается официальный счёт с овертаймом и буллитами.</small>
  </FormPanel>;
}
