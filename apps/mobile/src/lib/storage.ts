import AsyncStorage from '@react-native-async-storage/async-storage';

export type ConnectionMode = 'admin' | 'person';

export interface PersistedMobileSession {
  baseUrl: string;
  mode: ConnectionMode;
  authToken: string | null;
}

const STORAGE_KEY = 'pmeow.mobile.session';

function isConnectionMode(value: unknown): value is ConnectionMode {
  return value === 'admin' || value === 'person';
}

export async function loadPersistedSession(): Promise<PersistedMobileSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedMobileSession>;
    if (typeof parsed.baseUrl !== 'string' || !isConnectionMode(parsed.mode)) {
      return null;
    }

    return {
      baseUrl: parsed.baseUrl,
      mode: parsed.mode,
      authToken: typeof parsed.authToken === 'string' ? parsed.authToken : null,
    };
  } catch {
    return null;
  }
}

export async function savePersistedSession(session: PersistedMobileSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}
