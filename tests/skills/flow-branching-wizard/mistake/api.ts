// Backend client (stub). Do not change this file.
// The stub records every call so the UI tests can see what was sent.

export interface SignupPayload {
  fullName: string;
  email: string;
  plan: "free" | "pro" | "enterprise";
  companyName?: string;
}

export async function completeSignup(payload: SignupPayload): Promise<{ id: string }> {
  const log = (globalThis as { __signups?: unknown[] }).__signups;
  log?.push(payload);
  return { id: "signup-1" };
}
