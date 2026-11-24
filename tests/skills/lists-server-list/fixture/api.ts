export interface Member {
  id: string;
  name: string;
}

export interface MemberSort {
  by: "name";
  dir: "asc" | "desc";
}

/**
 * The first 50 members in the requested order (a team can be larger). Without `sort` the server
 * uses its own order.
 */
export async function fetchMembers(sort?: MemberSort): Promise<Member[]> {
  const query = sort ? `?${new URLSearchParams({ sort: sort.by, dir: sort.dir })}` : "";
  const response = await fetch(`/api/members${query}`);
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
