"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { PalistorEntityProxy, PalistorList, PalistorRef } from "@palistor";

import type { Member, Team, TeamRow } from "./backend";
import { teamsConfig } from "./catalogConfig";

/** The row type does not describe the nested list: add it by hand. */
type TeamProxy = PalistorEntityProxy<TeamRow> & { members: PalistorList<Member> };

/**
 * Teams, each with a `members` list nested in its row. The rows of the nested
 * lists come inside the teams' `initialData`: they are each list's membership
 * and its baseline, so an add or a remove makes that list dirty and
 * `store.reset()` puts the server's members back.
 *
 * A store of its own: `store.reset()` is the form reset (the one that restores
 * the membership of nested lists), and it should not reach the lists of the
 * other blocks. `usePalistor` gives every component instance its own store.
 */
export function Teams({ teams }: { teams: Team[] }) {
  const t = useTranslations("ssr.catalog.teams");
  const store = usePalistor(() => ({ config: teamsConfig, initialData: { teams } }));
  const form = useForm(store);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {form.teams.map((team, _index, id) => (
          <TeamCard key={id} team={team} />
        ))}
      </div>
      <button
        data-testid="ssr-catalog-teams-reset"
        onClick={() => store.reset()}
        className="px-3 py-1.5 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
      >
        ↺ {t("reset")}
      </button>
    </div>
  );
}

function TeamCard({ team }: { team: PalistorRef<TeamRow> }) {
  const t = useTranslations("ssr.catalog.teams");
  const row = useForm(team) as TeamProxy;
  const members = row.members;
  const [draft, setDraft] = useState("");

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    members.add({ name }); // no id: the row gets a temporary one
    setDraft("");
  };

  return (
    <div
      data-testid="ssr-catalog-team"
      className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{row.name.value}</h3>
        {members.dirty && (
          <span data-testid="ssr-catalog-team-dirty" className="text-xs text-amber-600 dark:text-amber-400">
            ● {t("edited")}
          </span>
        )}
      </div>

      <ul className="space-y-1">
        {members.map((member, _index, id) => (
          <MemberRow key={id} member={member} onRemove={() => members.remove(id)} />
        ))}
      </ul>
      {members.length === 0 && (
        <p data-testid="ssr-catalog-team-empty" className="text-sm text-zinc-400 dark:text-zinc-500">
          {t("empty")}
        </p>
      )}

      <form onSubmit={add} className="flex gap-2">
        <input
          data-testid="ssr-catalog-team-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("newMember")}
          aria-label={t("newMember")}
          className="flex-1 min-w-0 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          data-testid="ssr-catalog-team-add"
          disabled={!draft.trim()}
          className="px-2 py-1 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t("add")}
        </button>
      </form>
    </div>
  );
}

function MemberRow({ member, onRemove }: { member: PalistorRef<Member>; onRemove: () => void }) {
  const t = useTranslations("ssr.catalog.teams");
  const name = useForm(member).name.value;

  return (
    <li
      data-testid="ssr-catalog-member"
      className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-200"
    >
      <span>{name}</span>
      <button
        onClick={onRemove}
        aria-label={t("remove", { name })}
        className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
      >
        ✕
      </button>
    </li>
  );
}
