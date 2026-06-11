import { Injectable, inject } from '@angular/core';

import { AuthSessionService } from '../auth/auth-session.service';
import { API_BASE_URL } from '../config/api-base-url';
import { Textbook, TextbookAnswer } from './textbook.model';

@Injectable({ providedIn: 'root' })
export class TextbookApiService {
  private readonly authSession = inject(AuthSessionService);

  async listTextbooks(): Promise<Textbook[]> {
    const response = await fetch(`${API_BASE_URL}/textbooks`, {
      headers: this.authHeaders()
    });

    if (!response.ok) {
      throw new Error(`Textbook list failed with status ${response.status}`);
    }

    const body = (await response.json()) as { textbooks: Textbook[] };
    return body.textbooks;
  }

  async uploadTextbook(file: File): Promise<Textbook> {
    const formData = new FormData();
    formData.set('file', file);

    const response = await fetch(`${API_BASE_URL}/textbooks/upload`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Textbook upload failed with status ${response.status}`);
    }

    const body = (await response.json()) as { textbook: Textbook };
    return body.textbook;
  }

  async askTextbook(textbookId: string, question: string): Promise<TextbookAnswer> {
    const response = await fetch(`${API_BASE_URL}/textbooks/${textbookId}/ask`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      throw new Error(`Textbook question failed with status ${response.status}`);
    }

    return (await response.json()) as TextbookAnswer;
  }

  private authHeaders(): Record<string, string> {
    const token = this.authSession.session()?.token;
    return token ? { authorization: `Bearer ${token}` } : {};
  }
}
