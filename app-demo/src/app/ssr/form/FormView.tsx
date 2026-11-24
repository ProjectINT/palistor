"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { FieldProxyNode, PalistorList, PalistorProxy, PalistorRef } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { SsrShell } from "../shared/SsrShell";
import { ROLES, isFailNextArmed, setFailNext, subscribeFailures } from "./backend";
import type { Activity, Announcement, FailingEndpoint, Profile, UserOption } from "./backend";
import { DraftBlock } from "./DraftBlock";
import { profileConfig } from "./formConfig";
import { Flag, INPUT_CLASS, LABEL_CLASS, TextField, buttonClass } from "./ui";

export interface FormViewProps {
  /** The options of the user selector. */
  users: UserOption[];
  /** The user the server loaded the profile and the activity for. */
  userId: string;
  profile: Profile;
  activity: Activity[];
  announcement: Announcement;
}

/**
 * The client side of /ssr/form. It renders twice — on the server into HTML,
 * in the browser to hydrate it — each time with a store built from the same
 * props. The translator and the notifier come from <PalistorProvider>
 * (shared/SsrProviders.tsx) through the constructor.
 *
 * The only component of blocks 1–3 that sees the store: it hands each block
 * the nodes it shows, and every component below is on the node its parent
 * gave it — a group, a list, a row or a single field.
 */
export function FormView({ users, userId, profile, activity, announcement }: FormViewProps) {
  const t = useTranslations("ssr.form");

  // The resolvers' results, from the server: the profile and the list start
  // resolved, and `userId` gets its value (and dirty baseline) too.
  const store = usePalistor(() => ({ config: profileConfig, initialData: { userId, profile, activity } }));
  // Only navigates: reads no state, so an edit below never re-renders the view.
  const form = useForm(store);

  return (
    <SsrShell subtitle={t("subtitle")}>
      <Block
        testId="ssr-form-profile"
        title={t("profile.title")}
        hint={t("profile.hint")}
        footer={<Counter event="form.profile" testId="ssr-form-profile-requests" />}
      >
        <ProfileForm profile={form.profile} />
      </Block>

      <Block
        testId="ssr-form-deps"
        title={t("deps.title")}
        hint={t("deps.hint")}
        footer={<Counter event="form.activity" testId="ssr-form-activity-requests" />}
      >
        <Dependencies userId={form.userId} activity={form.activity} users={users} />
      </Block>

      <Block
        testId="ssr-form-errors"
        title={t("errors.title")}
        hint={t("errors.hint")}
        footer={<Counter event="form.errors" testId="ssr-form-errors-count" label={t("errors.count")} />}
      >
        <Failures activity={form.activity} />
      </Block>

      <DraftBlock announcement={announcement} />
    </SsrShell>
  );
}

// ─── 1. A group prefilled by the server ──────────────────────────────────────

function ProfileForm({ profile }: { profile: PalistorProxy<Profile> }) {
  const t = useTranslations("ssr.form");
  // Reads the group's own state (loading, dirty): re-renders when it flips, not on every keystroke.
  const p = useForm(profile);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Flag name="loading" value={p.loading} testId="ssr-form-profile-loading" />
        <Flag name="dirty" value={p.dirty} testId="ssr-form-profile-dirty" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField field={p.name} testId="ssr-form-name" />
        <TextField field={p.email} testId="ssr-form-email" type="email" />
      </div>

      <RoleField field={p.role} />

      <TextField field={p.bio} testId="ssr-form-bio" multiline />

      <button
        type="button"
        data-testid="ssr-form-reset"
        disabled={!p.dirty}
        onClick={() => p.reset()}
        className={buttonClass("neutral")}
      >
        {t("profile.reset")}
      </button>
    </div>
  );
}

function RoleField({ field }: { field: FieldProxyNode<string> }) {
  const t = useTranslations("ssr.form");
  const role = useForm(field);

  return (
    <label className="block">
      <span className={LABEL_CLASS}>{role.label}</span>
      <select
        data-testid="ssr-form-role"
        value={role.value}
        onChange={(e) => role.onValueChange(e.target.value)}
        className={INPUT_CLASS}
      >
        {ROLES.map((value) => (
          <option key={value} value={value}>
            {t(`roles.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── 2. Declared dependencies and reload() ───────────────────────────────────

/** Lays out two nodes of the form and reads neither: the user selector and the list that depends on it. */
function Dependencies({
  userId,
  activity,
  users,
}: {
  userId: FieldProxyNode<string>;
  activity: PalistorList<Activity>;
  users: UserOption[];
}) {
  return (
    <div className="space-y-4">
      <UserField field={userId} users={users} />
      <ActivityList activity={activity} />
    </div>
  );
}

function UserField({ field, users }: { field: FieldProxyNode<string>; users: UserOption[] }) {
  const userId = useForm(field);

  return (
    <label className="block">
      <span className={LABEL_CLASS}>{userId.label}</span>
      <select
        data-testid="ssr-form-user"
        value={userId.value}
        onChange={(e) => userId.onValueChange(e.target.value)}
        className={INPUT_CLASS}
      >
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActivityList({ activity }: { activity: PalistorList<Activity> }) {
  const t = useTranslations("ssr.form.deps");
  const list = useForm(activity);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("activity")}</h3>
        <div className="flex items-center gap-2">
          <Flag name="resolveStatus" value={list.resolveStatus} testId="ssr-form-activity-status" />
          <button
            type="button"
            data-testid="ssr-form-reload"
            onClick={() => list.reload()}
            className={buttonClass("primary")}
          >
            {t("reload")}
          </button>
        </div>
      </div>
      <ul data-testid="ssr-form-activity-rows" className="space-y-1">
        {list.map((row, _index, id) => (
          <ActivityRow key={id} row={row} />
        ))}
      </ul>
      {list.length === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">{t("empty")}</p>
      )}
    </div>
  );
}

function ActivityRow({ row }: { row: PalistorRef<Activity> }) {
  const item = useForm(row);

  return (
    <li
      data-testid="ssr-form-activity"
      className="flex justify-between items-center gap-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{item.title.value}</span>
      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 shrink-0">{item.date.value}</span>
    </li>
  );
}

// ─── 3. onError → ctx.notify → the provider's notifier ───────────────────────

/** A switch of backend.ts. The server snapshot (and so the hydrating render) is "off". */
function useFailNext(endpoint: FailingEndpoint): boolean {
  return useSyncExternalStore(
    subscribeFailures,
    () => isFailNextArmed(endpoint),
    () => false,
  );
}

/** The list node block 2 shows, handed here too: this block connects to it on its own and shows its `error`. */
function Failures({ activity }: { activity: PalistorList<Activity> }) {
  const t = useTranslations("ssr.form.errors");
  const error = useForm(activity).error;

  return (
    <div className="space-y-3">
      <FailSwitch endpoint="form.profile" testId="ssr-form-fail-profile" label={t("failProfile")} />
      <FailSwitch endpoint="form.activity" testId="ssr-form-fail-activity" label={t("failActivity")} />
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        <code className="font-mono text-xs">activity.error</code>:{" "}
        <span data-testid="ssr-form-activity-error" className={`font-mono text-xs ${error ? "text-red-600 dark:text-red-400" : ""}`}>
          {error ? (error instanceof Error ? error.message : String(error)) : "null"}
        </span>
      </p>
    </div>
  );
}

function FailSwitch({ endpoint, testId, label }: { endpoint: FailingEndpoint; testId: string; label: string }) {
  const armed = useFailNext(endpoint);

  return (
    <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
      <input
        type="checkbox"
        data-testid={testId}
        checked={armed}
        onChange={(e) => setFailNext(endpoint, e.target.checked)}
        className="w-4 h-4 accent-red-600"
      />
      {label}
    </label>
  );
}
