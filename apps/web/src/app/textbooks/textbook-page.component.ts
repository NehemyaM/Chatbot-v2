import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthSessionService } from '../auth/auth-session.service';
import { TextbookApiService } from './textbook-api.service';
import { Textbook } from './textbook.model';

@Component({
  selector: 'app-textbook-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './textbook-page.component.html',
  styleUrl: './textbook-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextbookPageComponent {
  private readonly textbookApi = inject(TextbookApiService);
  private readonly authSession = inject(AuthSessionService);

  readonly answer = signal('');
  readonly error = signal('');
  readonly isAsking = signal(false);
  readonly isLoading = signal(false);
  readonly isUploading = signal(false);
  readonly question = signal('');
  readonly selectedTextbookId = signal('');
  readonly textbooks = signal<Textbook[]>([]);
  readonly session = this.authSession.session;
  readonly selectedTextbook = computed(() => this.textbooks().find((textbook) => textbook.id === this.selectedTextbookId()));

  constructor() {
    if (this.session()) {
      void this.loadTextbooks();
    }
  }

  async loadTextbooks(): Promise<void> {
    this.isLoading.set(true);
    this.error.set('');

    try {
      const textbooks = await this.textbookApi.listTextbooks();
      this.textbooks.set(textbooks);

      if (!this.selectedTextbookId() && textbooks.length > 0) {
        this.selectedTextbookId.set(textbooks[0].id);
      }
    } catch (error) {
      this.error.set(getErrorMessage(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  async uploadTextbook(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    this.isUploading.set(true);
    this.error.set('');
    this.answer.set('');

    try {
      const textbook = await this.textbookApi.uploadTextbook(file);
      this.textbooks.update((textbooks) => [textbook, ...textbooks]);
      this.selectedTextbookId.set(textbook.id);
    } catch (error) {
      this.error.set(getErrorMessage(error));
    } finally {
      this.isUploading.set(false);
      input.value = '';
    }
  }

  async askQuestion(): Promise<void> {
    const textbookId = this.selectedTextbookId();
    const question = this.question().trim();

    if (!textbookId || !question || this.isAsking()) {
      return;
    }

    this.isAsking.set(true);
    this.error.set('');
    this.answer.set('');

    try {
      const result = await this.textbookApi.askTextbook(textbookId, question);
      this.answer.set(result.answer);
    } catch (error) {
      this.error.set(getErrorMessage(error));
    } finally {
      this.isAsking.set(false);
    }
  }

  selectTextbook(textbookId: string): void {
    this.selectedTextbookId.set(textbookId);
    this.answer.set('');
    this.error.set('');
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
