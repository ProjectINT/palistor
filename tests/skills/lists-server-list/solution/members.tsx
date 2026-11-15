import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";
import { createMember, fetchMembers, type Member } from "./api";

const members = defineList<Member>({
  template: { id: { value: "" }, name: { value: "" } },
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

  if (list.resolveStatus === "error") {
    return (
      <div>
        <p>Could not load members</p>
        <button onClick={list.reload}>Retry</button>
      </div>
    );
  }
  // "idle" on the first render, then "pending": not an empty list yet.
  if (list.resolveStatus !== "resolved") return <p>Loading members…</p>;

  return (
    <div>
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
    </div>
  );
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
