"use client";

import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { ConfigProxy, PalistorProxy, StepStatus } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { SsrShell } from "../shared/SsrShell";
import { SelectField, Skeleton, TextField, buttonClass } from "../shared/ui";
import { MENTORS, type Profile, type Slot, type Team } from "./backend";
import { flowConfig } from "./flowConfig";

// A whole flow's type comes from the config (its steps are part of it); a step
// and a field are typed by their values.
type OnboardingFlow = ConfigProxy<typeof flowConfig>["onboarding"];
type BookingFlow = ConfigProxy<typeof flowConfig>["booking"];

const MENTOR_OPTIONS = MENTORS.map((name) => ({ value: name, label: name }));

/**
 * The client side of /ssr/flow. It renders on the server into HTML and again
 * in the browser during hydration, each time with a store of its own built
 * from the same props. The server's store is in server mode and enters no
 * step; the browser's enters the active step of each flow once the view has
 * committed (usePalistor calls store.start() in an effect).
 *
 * Only this component sees the store. It hands each block its flow; a flow
 * hands its active step down, and a step its fields.
 */
export function FlowView({ profile }: { profile: Profile }) {
  const t = useTranslations("ssr.flow");

  // A flow's initialData is keyed by step: the profile step starts resolved,
  // so entering it fires onEnter and onReady without a request.
  const store = usePalistor(() => ({ config: flowConfig, initialData: { onboarding: { profile } } }));
  // Only navigates: reads no state, so a step change or a keystroke below never re-renders it.
  const form = useForm(store);

  return (
    <SsrShell subtitle={t("subtitle")}>
      <Block
        testId="flow-onboarding"
        title={t("onboarding.title")}
        hint={t("onboarding.hint")}
        footer={
          <>
            <StepCounters step="profile" label={t("steps.profile")} />
            <StepCounters step="team" label={t("steps.team")} />
          </>
        }
      >
        <Onboarding flow={form.onboarding} />
      </Block>

      <Block
        testId="flow-booking"
        title={t("booking.title")}
        hint={t("booking.hint")}
        footer={<StepCounters step="slot" label={t("steps.slot")} />}
      >
        <Booking flow={form.booking} />
      </Block>
    </SsrShell>
  );
}

// ─── (1) A flow whose first step has server data ─────────────────────────────

function Onboarding({ flow }: { flow: OnboardingFlow }) {
  const t = useTranslations("ssr.flow");
  const onboarding = useForm(flow);
  const { steps, currentStepKey } = onboarding;

  return (
    <div>
      {/* Reading a step's `status` does not start its resolve (cube/contract/sliceI/flowSurface.test.tsx). */}
      <StepIndicator
        testId="flow-onboarding-steps"
        steps={[
          { key: "profile", label: t("steps.profile"), status: steps.profile.status },
          { key: "team", label: t("steps.team"), status: steps.team.status },
        ]}
      />

      <div
        data-testid="flow-onboarding-step"
        data-step={currentStepKey}
        data-loading={String(onboarding.loading)}
        className={STEP_CLASS}
      >
        {/* Only the active step is rendered: reading a field of a step that was never entered would wake its resolve.
            Handing a step down reads nothing of it. */}
        {currentStepKey === "profile" && <ProfileStep step={steps.profile} />}
        {currentStepKey === "team" && <TeamStep step={steps.team} />}
      </div>

      <FlowNav testId="flow-onboarding" flow={flow} />
    </div>
  );
}

function ProfileStep({ step }: { step: PalistorProxy<Profile> }) {
  const profile = useForm(step);

  return (
    <div className="space-y-3">
      <TextField testId="flow-profile-name" field={profile.name} />
      <TextField testId="flow-profile-email" field={profile.email} />
    </div>
  );
}

function TeamStep({ step }: { step: PalistorProxy<Team> }) {
  const t = useTranslations("ssr.flow");
  const team = useForm(step);

  // Entered in the browser: the resolver runs once; a later entry finds the result cached.
  if (team.loading) return <Skeleton testId="flow-team-skeleton" label={t("team.loading")} />;

  return (
    <div className="space-y-3">
      <SelectField testId="flow-team-mentor" field={team.mentor} options={MENTOR_OPTIONS} />
      <TextField testId="flow-team-channel" field={team.channel} />
    </div>
  );
}

// ─── (2) A flow whose first step has no server data ──────────────────────────

function Booking({ flow }: { flow: BookingFlow }) {
  const t = useTranslations("ssr.flow");
  const booking = useForm(flow);
  const { steps, currentStepKey } = booking;

  return (
    <div>
      <StepIndicator
        testId="flow-booking-steps"
        steps={[
          { key: "slot", label: t("steps.slot"), status: steps.slot.status },
          { key: "notes", label: t("steps.notes"), status: steps.notes.status },
        ]}
      />

      <div
        data-testid="flow-booking-step"
        data-step={currentStepKey}
        data-loading={String(booking.loading)}
        className={STEP_CLASS}
      >
        {currentStepKey === "slot" && <SlotStep step={steps.slot} />}
        {currentStepKey === "notes" && <NotesStep step={steps.notes} />}
      </div>

      <FlowNav testId="flow-booking" flow={flow} />
    </div>
  );
}

function SlotStep({ step }: { step: PalistorProxy<Slot> }) {
  const t = useTranslations("ssr.flow");
  const slot = useForm(step);

  // Server mode holds the active step's resolve: `loading` is already true in the
  // server's HTML, and in the browser's first render the run is about to start.
  if (slot.loading) return <Skeleton testId="flow-slot-skeleton" label={t("slot.loading")} />;

  return (
    <dl data-testid="flow-slot-content" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{slot.reviewer.label}</dt>
      <dd data-testid="flow-slot-reviewer" className="font-medium text-zinc-900 dark:text-zinc-100">
        {slot.reviewer.value}
      </dd>
      <dt className="text-zinc-500 dark:text-zinc-400">{slot.startsAt.label}</dt>
      <dd data-testid="flow-slot-starts-at" className="font-medium text-zinc-900 dark:text-zinc-100">
        {slot.startsAt.value}
      </dd>
    </dl>
  );
}

function NotesStep({ step }: { step: PalistorProxy<{ topic: string }> }) {
  return <TextField testId="flow-notes-topic" field={useForm(step).topic} />;
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

const STEP_CLASS = "rounded-lg border border-zinc-100 dark:border-zinc-800 p-4";

/** onEnter, onReady and resolver calls of one step (counted in flowConfig.ts and backend.ts). */
function StepCounters({ step, label }: { step: string; label: string }) {
  return (
    <div className="w-full flex flex-wrap gap-x-4 gap-y-1">
      <span className="font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <Counter event={`flow.${step}.onEnter`} testId={`flow-${step}-enter`} label="onEnter" />
      <Counter event={`flow.${step}.onReady`} testId={`flow-${step}-ready`} label="onReady" />
      <Counter event={`flow.${step}`} testId={`flow-${step}-requests`} />
    </div>
  );
}

type Dot = "active" | "completed" | "pending";

const DOT_CLASS: Record<Dot, string> = {
  active: "bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/40",
  completed: "bg-green-600 text-white",
  pending: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

const STEP_LABEL_CLASS: Record<Dot, string> = {
  active: "text-blue-600 dark:text-blue-400 font-medium",
  completed: "text-green-600 dark:text-green-400",
  pending: "text-zinc-400 dark:text-zinc-500",
};

/** The steps with their `status` ("active" | "completed" | null = not visited yet). */
function StepIndicator({
  testId,
  steps,
}: {
  testId: string;
  steps: Array<{ key: string; label: string; status: StepStatus }>;
}) {
  return (
    <ol data-testid={testId} className="mb-4 flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const dot: Dot = step.status ?? "pending";
        return (
          <li key={step.key} data-step={step.key} data-status={dot} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${DOT_CLASS[dot]}`}
            >
              {step.status === "completed" ? "✓" : index + 1}
            </span>
            <span className={`text-sm ${STEP_LABEL_CLASS[dot]}`}>{step.label}</span>
            {index < steps.length - 1 && <span className="h-px w-8 bg-zinc-200 dark:bg-zinc-700" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Back / Next and the visit path (`flow.history`) of the flow it is handed. */
function FlowNav({ testId, flow }: { testId: string; flow: OnboardingFlow | BookingFlow }) {
  const t = useTranslations("ssr.flow");
  const nav = useForm(flow);
  const current = nav.steps.current;
  const last = nav.currentStepIndex === nav.steps.length - 1;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          data-testid={`${testId}-back`}
          disabled={!nav.canGoBack}
          onClick={() => nav.back()}
          className={buttonClass("neutral")}
        >
          {t("back")}
        </button>
        {last ? (
          <span className="text-sm text-zinc-400 dark:text-zinc-500">{t("lastStep")}</span>
        ) : (
          <button
            type="button"
            data-testid={`${testId}-next`}
            disabled={current.loading || current.submitting}
            // step.submit() validates the step; its onSubmit calls nextStep() (flowConfig.ts).
            onClick={() => void current.submit()}
            className={buttonClass("primary")}
          >
            {t("next")}
          </button>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
        <span className="font-mono">flow.history:</span>
        <span data-testid={`${testId}-history`} className="font-mono text-zinc-600 dark:text-zinc-400">
          {nav.history.join(" → ")}
        </span>
      </p>
    </div>
  );
}
