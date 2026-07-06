import request, { Test } from 'supertest';
import { createApp } from '../../src/app';
import { authHeaders } from './liveAuth';

let appInstance: ReturnType<typeof createApp> | null = null;

export function getLiveApp() {
  if (!appInstance) {
    appInstance = createApp();
  }
  return appInstance;
}

function withAuth(req: Test): Test {
  const headers = authHeaders();
  return req.set('Authorization', headers.Authorization).set('Cookie', headers.Cookie);
}

export function liveGet(path: string) {
  return withAuth(request(getLiveApp()).get(path));
}

export function livePost(path: string) {
  return withAuth(request(getLiveApp()).post(path));
}

export function livePatch(path: string) {
  return withAuth(request(getLiveApp()).patch(path));
}

export function liveDelete(path: string) {
  return withAuth(request(getLiveApp()).delete(path));
}
