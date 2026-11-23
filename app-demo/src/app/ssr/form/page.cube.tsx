import { activityOf, findUser, optionsOf, profileOf } from "./backend";
import type { Announcement, UserRecord } from "./backend";
import { readJson } from "../shared/db";
import { SsrProviders } from "../shared/SsrProviders";
import { FormView } from "./FormView";

// /ssr/form — a Server Component. It reads the data where it lives (here JSON
// files, in an app a database or an API called with the user's cookies) and
// hands the client view exactly what the stores' resolvers would return on
// their first run: the profile and the activity of the user the page opens
// with, and the published announcement. The view passes them as `initialData`.
//
// Static export: nothing here depends on the request, so the page is rendered
// once at build time (per request in dev).

/** The user the page opens with: in an app, the signed-in user or a route param. */
const OPENING_USER = "usr-1";

export default async function SsrFormPage() {
  const [table, announcement] = await Promise.all([
    readJson<UserRecord[]>("form", "users.json"),
    readJson<Announcement>("form", "announcement.json"),
  ]);
  const user = findUser(table, OPENING_USER);

  return (
    <SsrProviders>
      <FormView
        users={optionsOf(table)}
        userId={user.id}
        profile={profileOf(user)}
        activity={activityOf(user)}
        announcement={announcement}
      />
    </SsrProviders>
  );
}
