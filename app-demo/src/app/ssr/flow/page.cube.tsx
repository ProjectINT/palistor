import { readJson } from "../shared/db";
import { SsrProviders } from "../shared/SsrProviders";
import type { Profile } from "./backend";
import { FlowView } from "./FlowView";

// /ssr/flow — a Server Component. It reads the profile the first step of the
// onboarding flow would request and hands it to the client view, which passes
// it to its store as that step's initialData. The booking flow gets nothing
// from here: its first step loads in the browser.

export default async function SsrFlowPage() {
  // What the profile step's resolver would return: the browser's fake endpoint answers from the same file.
  const profile = await readJson<Profile>("flow", "profile.json");

  return (
    <SsrProviders>
      <FlowView profile={profile} />
    </SsrProviders>
  );
}
