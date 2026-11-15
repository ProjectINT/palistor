export interface Member {
  id: string;
  name: string;
}

export async function fetchMembers(): Promise<Member[]> {
  const response = await fetch("/api/members");
  if (!response.ok) throw new Error(`GET /api/members failed with ${response.status}`);
  return response.json();
}

export async function createMember(input: { name: string }): Promise<Member> {
  const response = await fetch("/api/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`POST /api/members failed with ${response.status}`);
  return response.json();
}
