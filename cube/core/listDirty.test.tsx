/**
 * `dirty` of a list whose rows own lists (cube project only). store stops at
 * the nested list and the row that owns it; here an edit inside a nested list
 * also makes the list of that row and the form dirty. The part both
 * implementations can be asked about is in cube/contract/sliceC/entityListDirty.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { Palistor } from "../palistor";
import { defineList } from "../defineList";
import { useForm } from "../react/useForm";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const device = { id: { value: "" }, kind: { value: "" } };
const member = { id: { value: "" }, name: { value: "" }, devices: defineList({ template: device }) };
const team = { id: { value: "" }, name: { value: "" }, info: { members: defineList({ template: member }) } };

const TEAMS = [
  { id: "t1", name: "Core", info: { members: [{ id: "m1", name: "Ann", devices: [{ id: "d1", kind: "laptop" }] }] } },
  { id: "t2", name: "Web", info: { members: [{ id: "m2", name: "Bob", devices: [] }] } },
];

function teamsStore() {
  const store = new Palistor({
    config: { title: { value: "" }, teams: defineList({ template: team }) } as any,
    initialData: { teams: TEAMS },
  } as any);
  const form = store.proxy as any;
  const devicesOf = (teamId: string, memberId: string) => form.teams.getById(teamId).info.members.getById(memberId).devices;
  return { store, form, devicesOf };
}

describe("dirty of a list whose rows own lists", () => {
  it("three levels: an edit in the deepest list makes every list, row and group above it dirty", () => {
    const { form, devicesOf } = teamsStore();
    const t1 = form.teams.getById("t1");
    const m1 = t1.info.members.getById("m1");
    const chain = () => [m1.devices.dirty, m1.dirty, t1.info.members.dirty, t1.info.dirty, t1.dirty, form.teams.dirty, form.dirty];
    expect(chain()).toEqual([false, false, false, false, false, false, false]);

    devicesOf("t1", "m1").add({ id: "d2", kind: "phone" });
    expect(chain()).toEqual([true, true, true, true, true, true, true]);
    expect(form.teams.getById("t2").dirty).toBe(false); // the other row's lists are clean

    devicesOf("t1", "m1").remove("d2");
    expect(chain()).toEqual([false, false, false, false, false, false, false]);
  });

  it("a row's field values still take no part: the list is dirty by composition only", () => {
    const { form } = teamsStore();
    const m1 = form.teams.getById("t1").info.members.getById("m1");
    m1.name.value = "Anna";
    expect(m1.dirty).toBe(true);
    expect(form.teams.getById("t1").info.members.dirty).toBe(false);
    expect(form.teams.dirty).toBe(false);
  });

  it("store.reset() clears the whole chain and requests nothing", () => {
    const { store, form, devicesOf } = teamsStore();
    devicesOf("t1", "m1").add({ id: "d2", kind: "phone" });
    devicesOf("t2", "m2").add({ id: "d3", kind: "tablet" });
    expect(form.dirty).toBe(true);

    store.reset();
    expect([form.teams.dirty, form.dirty, form.teams.getById("t1").dirty, form.teams.getById("t2").dirty]).toEqual([false, false, false, false]);
    expect(store.getValues()).toEqual({ title: "", teams: TEAMS });
  });

  it("a component that reads only the form's dirty re-renders when a nested list is edited and when it is undone", () => {
    const { store, devicesOf } = teamsStore();
    let renders = 0;
    function Unsaved() {
      const form = useForm(store) as any;
      renders++;
      return <output>{String(form.dirty)}/{String(form.teams.dirty)}</output>;
    }
    const { container } = render(<Unsaved />);
    expect(container.textContent).toBe("false/false");

    act(() => { devicesOf("t1", "m1").add({ id: "d2", kind: "phone" }); });
    expect(container.textContent).toBe("true/true");
    const afterEdit = renders;

    act(() => { devicesOf("t2", "m2").add({ id: "d3", kind: "tablet" }); }); // still dirty: nothing to render
    expect(renders).toBe(afterEdit);

    act(() => { devicesOf("t1", "m1").remove("d2"); devicesOf("t2", "m2").remove("d3"); });
    expect(container.textContent).toBe("false/false");
  });

  it("the same row in two lists: both lists follow its nested list", () => {
    const store = new Palistor({
      config: {
        all: defineList({ template: member }),
        favourites: defineList({ template: member }),
      } as any,
    });
    const form = store.proxy as any;
    store.set({ id: "m1", name: "Ann" });
    form.all.setItems(["m1"]);
    form.favourites.setItems(["m1"]);
    store.reset({}); // nothing to restore; the lists keep their membership
    const before = [form.all.dirty, form.favourites.dirty];

    form.all.getById("m1").devices.add({ id: "d1", kind: "laptop" });
    expect(form.favourites.getById("m1").devices.length).toBe(1); // one membership, shared by every view of the owner
    expect([form.all.dirty, form.favourites.dirty]).toEqual([true, true]);
    expect(before).toEqual([true, true]); // set by hand, the two root lists were dirty by their own membership already
  });

  it("reading dirty opens no nested list: rows whose lists nobody opened are skipped by a map lookup", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}` }));
    const store = new Palistor({
      config: { members: defineList({ template: member, resolve: { resolver: async () => rows, onError: vi.fn() } }) } as any,
    });
    const form = store.proxy as any;
    /** Every list cube alive: the root list, plus one per row whose `devices` was built. */
    const lists = () => (store as any).hub.lists.size;
    void form.members.length;
    await flush();
    expect(lists()).toBe(1);
    expect(form.members.dirty).toBe(false);
    expect(form.dirty).toBe(false);
    expect(lists()).toBe(1);

    form.members.getById("m7").devices.add({ id: "d1", kind: "laptop" });
    expect(form.members.dirty).toBe(true);
    expect(lists()).toBe(2);
  });

  it("a dirty nested list under another list does not touch this one", () => {
    const store = new Palistor({
      config: { staff: defineList({ template: member }), guests: defineList({ template: member }) } as any,
      initialData: { staff: [{ id: "m1", name: "Ann" }], guests: [{ id: "g1", name: "Guy" }] },
    } as any);
    const form = store.proxy as any;
    form.guests.getById("g1").devices.add({ id: "d1", kind: "phone" });
    expect([form.staff.dirty, form.guests.dirty, form.dirty]).toEqual([false, true, true]);
  });

  it("many dirty nested lists at once, then all undone", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}` }));
    const store = new Palistor({
      config: { members: defineList({ template: member }), others: defineList({ template: member }) } as any,
      initialData: { members: rows, others: [{ id: "o1", name: "Other" }] },
    } as any);
    const form = store.proxy as any;
    for (let i = 0; i < 30; i++) form.members.getById(`m${i}`).devices.add({ id: `d${i}`, kind: "phone" });
    expect([form.members.dirty, form.others.dirty]).toEqual([true, false]);
    for (let i = 0; i < 30; i++) form.members.getById(`m${i}`).devices.remove(`d${i}`);
    expect([form.members.dirty, form.others.dirty, form.dirty]).toEqual([false, false, false]);
    expect((store as any).hub.dirtyNested.size).toBe(0);
  });

  it("store.rekey of the owner keeps its dirty list counted; store.delete of the owner drops it", () => {
    const store = new Palistor({
      config: { members: defineList({ template: member }), others: defineList({ template: member }) } as any,
      initialData: { members: [{ id: "_tmp_1", name: "Ann" }, { id: "m2", name: "Bob" }], others: [{ id: "_tmp_1", name: "Ann" }] },
    } as any);
    const form = store.proxy as any;
    form.members.getById("_tmp_1").devices.add({ id: "d1", kind: "phone" });
    expect([form.members.dirty, form.others.dirty]).toEqual([true, true]);

    store.rekey("_tmp_1", "m1"); // the lists' membership and baseline move together: only the nested list keeps them dirty
    expect(form.members.items.map((m: any) => m.id)).toEqual(["m1", "m2"]);
    expect([form.members.dirty, form.others.dirty]).toEqual([true, true]);

    store.delete("m1");
    expect((store as any).hub.dirtyNested.size).toBe(0);
    form.members.getById("m2").devices.add({ id: "d2", kind: "phone" });
    form.members.getById("m2").devices.remove("d2");
    expect((store as any).hub.dirtyNested.size).toBe(0);
  });

  it("store.delete of an owner whose list is dirty by a removal forgets that list", async () => {
    // Dirty by a removal: the baseline still names the removed row, so the owner's deletion does not make the list clean.
    const store = new Palistor({
      config: {
        members: defineList({ template: member }),
        people: defineList({ template: { id: { value: "" }, name: { value: "" } } }),
        editor: {
          name: { value: "" },
          devices: defineList({ template: device, resolve: { resolver: async () => [{ id: "e1", kind: "tablet" }], onError: vi.fn() } }),
        },
      } as any,
      initialData: {
        members: [{ id: "m1", name: "Ann", devices: [{ id: "d1", kind: "laptop" }] }, { id: "m2", name: "Bob" }],
        people: [{ id: "p1", name: "Pat" }],
      },
    } as any);
    const form = store.proxy as any;
    const dirtyNested = () => (store as any).hub.dirtyNested.size;

    form.members.getById("m1").devices.remove("d1");
    expect(dirtyNested()).toBe(1);
    store.delete("m1");
    expect(dirtyNested()).toBe(0);

    // The same through a mounted useForm(entity, template) view, which is bumped once more as its row goes.
    const { result } = renderHook(() => useForm(form.people.getById("p1"), (proxy: any) => proxy.editor) as any);
    void result.current.devices.items;
    await act(flush);
    act(() => { result.current.devices.remove("e1"); });
    expect(dirtyNested()).toBe(1);
    act(() => { store.delete("p1"); });
    expect(dirtyNested()).toBe(0);
  });

  it("a nested row edited through another template: a list it owns there reaches the lists above it", () => {
    // `people` rows are plain here; the editor template gives the same row a `devices` list.
    const person = { id: { value: "" }, name: { value: "" } };
    const store = new Palistor({
      config: {
        teams: defineList({ template: { id: { value: "" }, people: defineList({ template: person }) } }),
        editor: { name: { value: "" }, devices: defineList({ template: device }) },
      } as any,
      initialData: { teams: [{ id: "t1", people: [{ id: "p1", name: "Ann" }] }] },
    } as any);
    const form = store.proxy as any;
    const p1 = form.teams.getById("t1").people.getById("p1");
    const { result } = renderHook(() => useForm(p1, (proxy: any) => proxy.editor) as any);
    expect([form.teams.dirty, form.dirty]).toEqual([false, false]);

    act(() => { result.current.devices.add({ id: "d1", kind: "laptop" }); });
    // p1 is not a row of `teams`: the walk goes down through t1's people to find it.
    expect([form.teams.dirty, form.dirty]).toEqual([true, true]);
    act(() => { result.current.devices.remove("d1"); });
    expect([form.teams.dirty, form.dirty]).toEqual([false, false]);
  });

  it("a row with a dirty list leaves a nested list by a reload: the lists above stop counting it", async () => {
    let people = [{ id: "p1", name: "Ann" }, { id: "p2", name: "Bob" }];
    const store = new Palistor({
      config: {
        teams: defineList({
          template: {
            id: { value: "" },
            people: defineList({ template: member, resolve: { resolver: async () => people, onError: vi.fn() } }),
          },
        }),
      } as any,
      initialData: { teams: [{ id: "t1" }] },
    } as any);
    const form = store.proxy as any;
    const list = form.teams.getById("t1").people;
    void list.items;
    await flush();
    list.getById("p1").devices.add({ id: "d1", kind: "laptop" });
    expect([list.dirty, form.teams.dirty]).toEqual([true, true]); // `people` as loaded, but its row p1 owns a dirty list

    people = [{ id: "p2", name: "Bob" }];
    list.reload();
    await flush();
    // Membership and baseline moved together: no list's own composition became dirty or clean, yet p1 is no longer under `teams`.
    expect(list.items.map((p: any) => p.id)).toEqual(["p2"]);
    expect([list.dirty, form.teams.dirty, form.dirty]).toEqual([false, false, false]);
  });

  it("a row that is a member of its own list does not loop", () => {
    const leaf = { id: { value: "" }, children: defineList({ template: { id: { value: "" } } }) };
    const store = new Palistor({
      config: { nodes: defineList({ template: { id: { value: "" }, children: defineList({ template: leaf }) } }) } as any,
      initialData: { nodes: [{ id: "n1", children: [{ id: "n1" }, { id: "n2" }] }] },
    } as any);
    const form = store.proxy as any;
    expect(form.nodes.dirty).toBe(false);
    expect(form.dirty).toBe(false);

    // A dirty list under n2, which is not a row of `nodes`: the walk from n1 passes n1 again on its way to n2.
    form.nodes.getById("n1").children.getById("n2").children.add({ id: "n3" });
    expect(form.nodes.dirty).toBe(true);
    store.reset();
    expect(form.nodes.dirty).toBe(false);
  });

  it("the nested list's reload() makes its rows the baseline: the chain is clean again", async () => {
    let rows = [{ id: "d1", kind: "laptop" }];
    const store = new Palistor({
      config: {
        members: defineList({
          template: {
            id: { value: "" },
            devices: defineList({ template: device, resolve: { resolver: async () => rows, onError: vi.fn() } }),
          },
        }),
      } as any,
      initialData: { members: [{ id: "m1" }] },
    } as any);
    const form = store.proxy as any;
    const devices = form.members.getById("m1").devices;
    void devices.items;
    await flush();
    devices.add({ id: "d2", kind: "phone" });
    expect([devices.dirty, form.members.dirty, form.dirty]).toEqual([true, true, true]);

    rows = [...rows, { id: "d2", kind: "phone" }]; // saved on the server
    devices.reload();
    await flush();
    expect([devices.dirty, form.members.getById("m1").dirty, form.members.dirty, form.dirty]).toEqual([false, false, false, false]);
  });
});

describe("dirty of a paginated list whose rows own lists", () => {
  const ALL = Array.from({ length: 6 }, (_, i) => ({ id: `m${i + 1}`, name: `Member ${i + 1}` }));
  function pagedStore() {
    const resolver = vi.fn(async (_v: unknown, _s: unknown, ctx: any) => ({
      items: ALL.slice(ctx.page.offset, ctx.page.offset + ctx.page.pageSize),
      total: ALL.length,
    }));
    const store = new Palistor({
      config: {
        members: defineList({ template: member, resolve: { resolver, onError: vi.fn(), pagination: { pageSize: 3 } } }),
      } as any,
    });
    return { store, form: store.proxy as any, resolver };
  }

  it("a nested edit on a cached page that is off screen keeps the list dirty; reset clears it", async () => {
    const { store, form, resolver } = pagedStore();
    void form.members.items;
    await flush();
    form.members.getById("m1").devices.add({ id: "d1", kind: "laptop" });
    expect([form.members.dirty, form.dirty]).toEqual([true, true]);

    form.members.setPage(2);
    await flush();
    expect(form.members.items.map((m: any) => m.id)).toEqual(["m4", "m5", "m6"]);
    expect([form.members.dirty, form.dirty]).toEqual([true, true]); // page 1 is cached: its rows still count

    // m1's row is off screen: its view and its list cube are gone, the membership lives with the owner.
    store.reset();
    expect([form.members.dirty, form.dirty]).toEqual([false, false]);
    expect(resolver).toHaveBeenCalledTimes(2);

    form.members.setPage(1); // cached
    expect(form.members.getById("m1").devices.length).toBe(0);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("a page of a nested list brings in a row that already owns a dirty list: the lists above see it", async () => {
    // m3 is also a row of `everyone`, where its devices were edited. Then page 2 of t1's members loads it.
    const PEOPLE = [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }];
    const store = new Palistor({
      config: {
        everyone: defineList({ template: member }),
        teams: defineList({
          template: {
            id: { value: "" },
            members: defineList({
              template: member,
              resolve: {
                resolver: async (_v: unknown, _s: unknown, ctx: any) => ({ items: PEOPLE.slice(ctx.page.offset, ctx.page.offset + 2), total: 4 }),
                onError: vi.fn(),
                pagination: { pageSize: 2 },
              },
            }),
          },
        }),
      } as any,
      initialData: { everyone: [{ id: "m3", name: "Cy" }], teams: [{ id: "t1" }] },
    } as any);
    const form = store.proxy as any;
    const members = form.teams.getById("t1").members;
    void members.items;
    await flush();
    form.everyone.getById("m3").devices.add({ id: "d1", kind: "laptop" });
    expect([form.everyone.dirty, form.teams.dirty]).toEqual([true, false]);

    members.setPage(2); // a fetched page is not an edit: no list becomes dirty or clean by its own composition
    await flush();
    expect(members.items.map((m: any) => m.id)).toEqual(["m3", "m4"]);
    expect([members.dirty, form.teams.dirty]).toEqual([true, true]);
  });

  it("a paginated nested list: an un-flushed add inside it reaches the list above", async () => {
    const nestedResolver = vi.fn(async () => ({ items: [{ id: "d1", kind: "laptop" }], total: 1 }));
    const store = new Palistor({
      config: {
        members: defineList({
          template: {
            id: { value: "" },
            devices: defineList({ template: device, resolve: { resolver: nestedResolver, onError: vi.fn(), pagination: { pageSize: 5 } } }),
          },
        }),
      } as any,
      initialData: { members: [{ id: "m1" }] },
    } as any);
    const form = store.proxy as any;
    const devices = form.members.getById("m1").devices;
    void devices.items;
    await flush();
    expect([devices.dirty, form.members.dirty, form.dirty]).toEqual([false, false, false]);

    devices.add({ id: "d2", kind: "phone" });
    expect([devices.dirty, form.members.dirty, form.dirty]).toEqual([true, true, true]);
    devices.remove("d2");
    expect([devices.dirty, form.members.dirty, form.dirty]).toEqual([false, false, false]);
  });
});
