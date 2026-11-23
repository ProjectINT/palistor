// The mistake: "Treating a failed or not-yet-started list as empty"
// (skills/palistor-lists/SKILL.md, Common Mistakes). The empty state is decided
// by `!loading && length === 0`, and a failed load is only sent to onError:
// the screen says "No members yet" after a failure. (`loading` is true from the
// read that starts the load, so the first render itself shows "Loading members…".)
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";
import { createMember, fetchMembers, type Member } from "./api";

const members = defineList<Member>({
  template: { id: { value: "" }, name: { value: "" } },
  resolve: {
    resolver: async () => fetchMembers(),
    onError: (error, { notify }) => notify("Could not load members"),
  },
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

  if (list.loading) return <p>Loading members…</p>;

  return (
    <div>
      {list.length === 0 ? (
        <p>No members yet</p>
      ) : (
        <ul>
          {list.map((member, index, id) => (
            <MemberRow key={id} member={member} />
          ))}
        </ul>
      )}
      <button onClick={list.reload}>Retry</button>
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
