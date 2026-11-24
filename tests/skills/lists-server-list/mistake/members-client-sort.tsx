// Mistake: "Sorting in the browser what only the server has" (skills/palistor-lists/references/sorting.md).
// The sort block has no `$server: true`, so the list orders the first 50 members it holds by itself: a click
// sends no request, and members beyond the first 50 never appear in a sorted view.
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef, SortProxyNode } from "palistor";
import { createMember, fetchMembers, type Member } from "./api";

const members = defineList<Member>({
  template: { id: { value: "" }, name: { value: "" } },
  sort: { name: true },
  resolve: { resolver: async () => fetchMembers() },
});

export const membersStore = new Palistor({ config: { members } });

export function MembersScreen() {
  const form = useForm(membersStore);
  const list = form.members;

  async function addMember() {
    const tempId = `_tmp_${crypto.randomUUID()}`;
    list.add({ id: tempId, name: "New member" });
    try {
      const saved = await createMember({ name: "New member" });
      membersStore.rekey(tempId, saved.id);
      membersStore.set({ ...saved });
    } catch {
      membersStore.delete(tempId);
    }
  }

  // This read starts the lazy load, so it sits above every early return.
  const count = list.length;

  let body;
  if (list.resolveStatus === "error") {
    body = (
      <div>
        <p>Could not load members</p>
        <button onClick={list.reload}>Retry</button>
      </div>
    );
  } else if (list.resolveStatus !== "resolved") {
    // "idle" on the first render, then "pending" (also while a new sort loads): not an empty list yet.
    body = <p>Loading members…</p>;
  } else {
    body = (
      <>
        {count === 0 ? (
          <p>No members yet</p>
        ) : (
          <ul>
            {list.map((member, index, id) => (
              <MemberRow key={id} member={member} />
            ))}
          </ul>
        )}
        <button onClick={addMember}>Add member</button>
      </>
    );
  }

  return (
    <div>
      <SortByName sort={list.sort!} />
      {body}
    </div>
  );
}

function SortByName({ sort }: { sort: SortProxyNode<keyof Member & string> }) {
  const s = useForm(sort);
  const dir = s.dirOf("name");
  return <button onClick={() => s.toggle("name")}>Name{dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : ""}</button>;
}

function MemberRow({ member }: { member: PalistorRef<Member> }) {
  const row = useForm(member);
  return (
    <li>
      <input
        aria-label="Member name"
        value={row.name.value}
        onChange={(event) => row.name.onValueChange(event.target.value)}
      />
    </li>
  );
}
