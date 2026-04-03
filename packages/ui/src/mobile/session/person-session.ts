const TOKEN_KEY = 'pmeow_person_token';

export function getPersonToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setPersonToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearPersonToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
