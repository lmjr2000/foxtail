import { beforeEach, describe, expect, it } from 'vitest';
import { api, makeUser, PASSWORD, resetDb } from './helpers.js';

beforeEach(async () => { await resetDb(); });

describe('sign-in', () => {
  it('signs in with email + password (email is case-insensitive)', async () => {
    const u = await makeUser('corporate_admin', null, 'Boss@Example.com');
    const res = await api().post('/api/auth/login').send({ email: 'boss@example.COM', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: u.user.id, role: 'corporate_admin' });
    expect(res.body.user.passwordHash).toBeUndefined();
    const me = await api().get('/api/auth/me').set({ Authorization: `Bearer ${res.body.token}` });
    expect(me.body.user.email).toBe('Boss@Example.com');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await makeUser('corporate_admin', null, 'boss@example.com');
    const a = await api().post('/api/auth/login').send({ email: 'boss@example.com', password: 'nope' });
    const b = await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('slows down password guessing', async () => {
    await makeUser('corporate_admin', null, 'boss@example.com');
    for (let i = 0; i < 10; i++) await api().post('/api/auth/login').send({ email: 'boss@example.com', password: `wrong${i}` });
    const res = await api().post('/api/auth/login').send({ email: 'boss@example.com', password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('rejects requests without a valid session', async () => {
    expect((await api().get('/api/stores')).status).toBe(401);
    expect((await api().get('/api/stores').set({ Authorization: 'Bearer not-a-token' })).status).toBe(401);
  });
});

describe('temporary passwords', () => {
  it('a new login must choose a password before using anything else', async () => {
    const admin = await makeUser('corporate_admin');
    const created = await api().post('/api/users').set(admin.auth).send({ email: 'new@example.com', name: 'New', role: 'corporate_viewer' });
    expect(created.status).toBe(201);
    const temp = created.body.temporaryPassword as string;
    const login = await api().post('/api/auth/login').send({ email: 'new@example.com', password: temp });
    expect(login.body.user.mustChangePassword).toBe(true);
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const blocked = await api().get('/api/stores').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await api().post('/api/auth/change-password').set(auth).send({ currentPassword: temp, newPassword: 'short' })).status).toBe(400);
    const changed = await api().post('/api/auth/change-password').set(auth).send({ currentPassword: temp, newPassword: 'a much better password 7' });
    expect(changed.status).toBe(200);
    // The old session is retired; the new token works.
    expect((await api().get('/api/stores').set(auth)).status).toBe(401);
    expect((await api().get('/api/stores').set({ Authorization: `Bearer ${changed.body.token}` })).status).toBe(200);
  });

  it('keeps at least one active corporate admin', async () => {
    const admin = await makeUser('corporate_admin');
    const res = await api().patch(`/api/users/${admin.user.id}`).set(admin.auth).send({ role: 'corporate_viewer' });
    expect(res.status).toBe(409);
  });
});
