# Task: team members screen

Our React app keeps screen state in `palistor`. Build the "Team members" screen in `members.tsx`.

The API client already exists in `api.ts` (do not change it):

- `fetchMembers(): Promise<Member[]>`
- `createMember(input: { name: string }): Promise<Member>` — the server assigns the id

Export from `members.tsx`:

- `membersStore` — the Palistor store that holds the screen state
- `MembersScreen` — the React component

Behavior:

1. The members load from the API when the screen is shown. While they load, the screen says "Loading members…".
2. If loading fails, the screen says "Could not load members" and shows a "Retry" button that loads again.
3. If the server returns no members, the screen says "No members yet". That text must not appear before the first load has finished, nor when loading failed.
4. Each member is a list item with a text input (accessible name "Member name") bound to the member's name. Typing changes the name in the store.
5. An "Add member" button adds a member named "New member" to the end of the list at once, without waiting for the server, and calls `createMember`. When the server answers, that same row takes the server's id; no second row appears. If the call fails, the row is removed.

`membersStore.getValues().members` is the array of members currently in the list, each `{ id, name }`.
