declare global {
  interface Window {
    __CHAT_API_BASE_URL__?: string;
  }
}

// Runtime config lets the same Angular build point to localhost or a deployed gateway.
export const API_BASE_URL = window.__CHAT_API_BASE_URL__ || 'http://localhost:8080/api';
