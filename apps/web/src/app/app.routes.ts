import { Routes } from '@angular/router';

import { ChatPageComponent } from './chat/chat-page.component';
import { LearnPageComponent } from './learn/learn-page.component';
import { TextbookPageComponent } from './textbooks/textbook-page.component';

// Route the first screen to chat and keep a visual learning page nearby.
export const routes: Routes = [
  {
    path: '',
    component: ChatPageComponent
  },
  {
    path: 'learn',
    component: LearnPageComponent
  },
  {
    path: 'textbooks',
    component: TextbookPageComponent
  }
];
