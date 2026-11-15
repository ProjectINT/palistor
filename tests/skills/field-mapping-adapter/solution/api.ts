// Backend client (stub). Do not change this file.
// The stub records every call so the UI tests can see what was sent.

export interface ProfileValues {
  email: string;
  nickname: string;
  hasCompany: boolean;
  company: string;
}

export async function saveProfile(values: ProfileValues): Promise<{ ok: true }> {
  const log = (globalThis as { __savedProfiles?: unknown[] }).__savedProfiles;
  log?.push({ ...values });
  return { ok: true };
}
