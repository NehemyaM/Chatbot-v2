import { Injectable, signal } from '@angular/core';

import { API_BASE_URL } from '../config/api-base-url';

const SESSION_STORAGE_KEY = 'chat_assistant_session';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  readonly session = signal<AuthSession | null>(readStoredSession());

  async login(email: string, password: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Invalid email or password.' : `Login failed with status ${response.status}.`);
    }

    const session = (await response.json()) as AuthSession;
    this.session.set(session);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  logout(): void {
    this.session.set(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function readStoredSession(): AuthSession | null {
  const rawSession = localStorage.getItem(SESSION_STORAGE_KEY);

  if (!rawSession) {
    return null;
  }

  try {
    return JSON.parse(rawSession) as AuthSession;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}
