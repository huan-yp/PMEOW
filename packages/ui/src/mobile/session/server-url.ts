const SERVER_URL_KEY = 'pmeow_server_url';

export function getServerUrl(): string | null {
  return localStorage.getItem(SERVER_URL_KEY);
}

export function setServerUrl(url: string): void {
  localStorage.setItem(SERVER_URL_KEY, url.replace(/\/+$/, ''));
}

export function clearServerUrl(): void {
  localStorage.removeItem(SERVER_URL_KEY);
}
