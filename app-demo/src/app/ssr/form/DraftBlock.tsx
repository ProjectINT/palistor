"use client";

import { useTranslations } from "next-intl";
import { localStorageDriver, useForm, usePalistor, usePersist } from "@palistor";
import type { PalistorProxy } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { Flag, TextField, buttonClass } from "../shared/ui";
import type { Announcement } from "./backend";
import { draftConfig } from "./formConfig";

/** The localStorage key of the draft (e2e/ssr-form.spec.ts reads it). */
const DRAFT_KEY = "palistor-ssr-form-draft";

/**
 * Block 4: a store of its own, so the draft cannot touch blocks 1–3.
 *
 * The constructor applies the server's announcement; the server's HTML and the
 * hydrating render show it. usePersist reads localStorage in an effect, after
 * mount, and lays the saved draft over the server's values, which stay the
 * dirty baseline: the restored form is dirty and reset() returns to them.
 */
export function DraftBlock({ announcement }: { announcement: Announcement }) {
  const t = useTranslations("ssr.form.draft");
  const store = usePalistor(() => ({ config: draftConfig, initialData: { announcement } }));
  usePersist(store, { key: DRAFT_KEY, driver: localStorageDriver, debounce: 300 });
  // The store stays here (its persist manager too); the form below gets the group.
  const form = useForm(store);

  return (
    <Block
      testId="ssr-form-draft"
      title={t("title")}
      hint={t("hint")}
      footer={<Counter event="form.announcement" testId="ssr-form-announcement-requests" />}
    >
      <AnnouncementForm announcement={form.announcement} clearDraft={() => store.persist.clear()} />
    </Block>
  );
}

function AnnouncementForm({
  announcement,
  clearDraft,
}: {
  announcement: PalistorProxy<Announcement>;
  clearDraft: () => Promise<void>;
}) {
  const t = useTranslations("ssr.form.draft");
  const group = useForm(announcement);

  const discard = async () => {
    // reset() first: persist.clear() then counts the server's values as already
    // handled, so the debounced save that reset() scheduled writes nothing back.
    group.reset();
    await clearDraft();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Flag name="loading" value={group.loading} testId="ssr-form-draft-loading" />
        <Flag name="dirty" value={group.dirty} testId="ssr-form-draft-dirty" />
      </div>
      <TextField field={group.title} testId="ssr-form-draft-title" />
      <TextField field={group.body} testId="ssr-form-draft-body" multiline />
      <button
        type="button"
        data-testid="ssr-form-draft-discard"
        disabled={!group.dirty}
        onClick={() => void discard()}
        className={buttonClass("danger")}
      >
        {t("discard")}
      </button>
    </div>
  );
}
