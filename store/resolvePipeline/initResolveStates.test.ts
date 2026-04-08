import { describe, it, expect, vi } from "vitest";
import { initResolveStates } from "./initResolveStates";
import type { ResolveState } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStates() {
  return new Map<object, ResolveState>();
}

function makeResolver() {
  return vi.fn(async () => ({}));
}

function makeResolve(overrides?: object) {
  return { resolver: makeResolver(), onError: vi.fn(), ...overrides };
}

// ─── Phase 1: TemplateFieldResolveEntry ───────────────────────────────────────

describe("initResolveStates — Phase 1: template field entries", () => {
  it("returns TemplateFieldResolveEntry for a template field with resolve", () => {
    const fieldResolve = makeResolve();
    const template = {
      name: { value: "" },
      role: { value: "user", resolve: fieldResolve },
    };
    const config = {
      users: [template],
    };

    const states = makeStates();
    const entries = initResolveStates(config as any, states);

    const templateEntries = entries.filter((e: any) => e.isTemplateField === true);
    expect(templateEntries).toHaveLength(1);

    const entry = templateEntries[0] as any;
    expect(entry.node).toBe(template.role);
    expect(entry.resolve).toBe(fieldResolve);
    expect(entry.isListNode).toBe(false);
    expect(entry.isTemplateField).toBe(true);
    expect(entry.listNode).toBe(config.users);
  });

  it("does NOT create a global ResolveState for template field entries", () => {
    const fieldResolve = makeResolve();
    const template = {
      status: { value: false, resolve: fieldResolve },
    };
    const config = {
      items: [template],
    };

    const states = makeStates();
    initResolveStates(config as any, states);

    // No state should be created for the template field node
    expect(states.has(template.status)).toBe(false);
  });

  it("returns multiple TemplateFieldResolveEntry when multiple fields have resolve", () => {
    const resolve1 = makeResolve();
    const resolve2 = makeResolve();
    const template = {
      name: { value: "" },
      isActive: { value: false, resolve: resolve1 },
      bio: { value: "", resolve: resolve2 },
    };
    const config = {
      users: [template],
    };

    const states = makeStates();
    const entries = initResolveStates(config as any, states);

    const templateEntries = entries.filter((e: any) => e.isTemplateField === true);
    expect(templateEntries).toHaveLength(2);

    const nodes = templateEntries.map((e: any) => e.node);
    expect(nodes).toContain(template.isActive);
    expect(nodes).toContain(template.bio);
  });

  it("sets listNode to the parent list array for each template field entry", () => {
    const fieldResolve = makeResolve();
    const template = {
      score: { value: 0, resolve: fieldResolve },
    };
    const config = {
      players: [template],
    };

    const states = makeStates();
    const entries = initResolveStates(config as any, states);

    const entry = entries.find((e: any) => e.isTemplateField) as any;
    expect(entry.listNode).toBe(config.players);
  });

  it("does not produce TemplateFieldResolveEntry if template field has no resolve", () => {
    const template = {
      name: { value: "" },
      age: { value: 0 },
    };
    const config = {
      people: [template],
    };

    const states = makeStates();
    const entries = initResolveStates(config as any, states);

    const templateEntries = entries.filter((e: any) => e.isTemplateField === true);
    expect(templateEntries).toHaveLength(0);
  });

  it("handles two lists independently — entries reference their own listNode", () => {
    const resolve1 = makeResolve();
    const resolve2 = makeResolve();
    const template1 = { flag: { value: false, resolve: resolve1 } };
    const template2 = { active: { value: false, resolve: resolve2 } };
    const config = {
      list1: [template1],
      list2: [template2],
    };

    const states = makeStates();
    const entries = initResolveStates(config as any, states);

    const templateEntries = entries.filter((e: any) => e.isTemplateField) as any[];
    expect(templateEntries).toHaveLength(2);

    const entry1 = templateEntries.find((e: any) => e.node === template1.flag);
    const entry2 = templateEntries.find((e: any) => e.node === template2.active);

    expect(entry1.listNode).toBe(config.list1);
    expect(entry2.listNode).toBe(config.list2);
  });

  it("coexists with a list-level resolve — both entries are returned", () => {
    const listResolver = makeResolver();
    const fieldResolve = makeResolve();
    const template = {
      name: { value: "" },
      isActive: { value: false, resolve: fieldResolve },
    };
    const config = {
      users: [
        template,
        { resolve: { resolver: listResolver, onError: vi.fn() } },
      ],
    };

    const states = makeStates();
    const entries = initResolveStates(config as any, states);

    const listEntries = entries.filter((e: any) => e.isListNode === true);
    const templateEntries = entries.filter((e: any) => e.isTemplateField === true);

    expect(listEntries).toHaveLength(1);
    expect(templateEntries).toHaveLength(1);
    // List-level resolve DOES get a ResolveState
    expect(states.has(config.users as any)).toBe(true);
    // Template field resolve does NOT
    expect(states.has(template.isActive)).toBe(false);
  });

  it("TemplateFieldResolveEntry includes the correct fieldKey", () => {
    const resolve1 = makeResolve();
    const resolve2 = makeResolve();
    const template = {
      name: { value: "" },
      isActive: { value: false, resolve: resolve1 },
      bio: { value: "", resolve: resolve2 },
    };
    const config = {
      users: [template],
    };

    const states = makeStates();
    const entries = initResolveStates(config as any, states);
    const templateEntries = entries.filter((e: any) => e.isTemplateField) as any[];

    const isActiveEntry = templateEntries.find((e) => e.node === template.isActive);
    const bioEntry = templateEntries.find((e) => e.node === template.bio);

    expect(isActiveEntry?.fieldKey).toBe("isActive");
    expect(bioEntry?.fieldKey).toBe("bio");
  });
});
