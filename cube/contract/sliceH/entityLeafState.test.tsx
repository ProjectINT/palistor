/**
 * Field state of an entity leaf (a row field reached through a list item, or
 * through the useForm(entity, template) view). New in the contract (Phase
 * 2.6): the fieldMapping surface tests showed that Cube, since 2.1, gave an
 * entity leaf the form-leaf validity rules. Store's entity-leaf proxy:
 *
 *  - `isInvalid` / `errorMessage` run the field's own `validate` live: no
 *    revalidate gate (no submit needed), `isRequired` takes no part, false /
 *    undefined without a rule — the same rules entity submit checks;
 *  - the flags are booleans with store's defaults (isRequired, isReadOnly,
 *    isDisabled false; isVisible true), function flags get the row's values;
 *  - the spread order: the leaf keys, dirty, loading, submitting, submit,
 *    onValueChange last.
 *
 * Green on store.
 */
import { describe, it, expect } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Palistor, defineList, useForm } from "@impl";

function makeStore() {
  const store = new Palistor({
    config: {
      users: defineList<any>({
        template: {
          id: { value: "" },
          name: { value: "", validate: (v: string) => (v ? undefined : "Name?") },
          flags: {
            value: "",
            isRequired: true,
            isReadOnly: (v: any) => v.name === "ro",
            isVisible: (v: any) => v.name !== "hide",
          },
          plain: { value: "" },
          addr: { city: { value: "", validate: (v: string) => (v ? undefined : "City?") } },
        } as any,
      }),
      edit: {
        id: { value: "" },
        name: { value: "", isRequired: true, validate: (v: string) => (v.length > 2 ? undefined : "Too short") },
      },
    } as any,
  });
  const users = (store.proxy as any).users;
  users.add({ id: "u1", name: "Ann", flags: "", plain: "", addr: { city: "" } });
  return { store, users };
}

describe("entity leaf state", () => {
  it("validity is the field's validate, live: no submit needed, isRequired takes no part", () => {
    const { users } = makeStore();
    const item = users.items[0];
    expect(item.name.isInvalid).toBe(false);
    expect(item.name.errorMessage).toBeUndefined();
    item.name.value = "";
    expect(item.name.isInvalid).toBe(true);
    expect(item.name.errorMessage).toBe("Name?");
    // a nested group's leaf, never submitted
    expect(item.addr.city.isInvalid).toBe(true);
    expect(item.addr.city.errorMessage).toBe("City?");
    // isRequired on an empty value without a rule: valid
    expect(item.flags.isRequired).toBe(true);
    expect(item.flags.isInvalid).toBe(false);
    expect(item.plain.isInvalid).toBe(false);
  });

  it("flags are booleans with store's defaults; function flags read the row", () => {
    const { users } = makeStore();
    const item = users.items[0];
    expect(item.plain.isRequired).toBe(false);
    expect(item.plain.isReadOnly).toBe(false);
    expect(item.plain.isDisabled).toBe(false);
    expect(item.plain.isVisible).toBe(true);
    expect(item.flags.isReadOnly).toBe(false);
    item.name.value = "ro";
    expect(item.flags.isReadOnly).toBe(true);
    item.name.value = "hide";
    expect(item.flags.isVisible).toBe(false);
  });

  it("entity submit fails on the same rules the leaves show", async () => {
    const { users } = makeStore();
    const result = await users.items[0].submit();
    expect(result).toEqual({ success: false, errors: [{ path: "addr.city", message: "City?" }] });
    expect(users.items[0].addr.city.errorMessage).toBe("City?");
  });

  it("the useForm(entity, template) view's leaves follow the template's validate", () => {
    const { users } = makeStore();
    const { result } = renderHook(() => useForm(users.items[0], (s: any) => s.edit));
    expect(result.current.name.isInvalid).toBe(false);
    act(() => { result.current.name.value = "Al"; });
    expect(result.current.name.isInvalid).toBe(true);
    expect(result.current.name.errorMessage).toBe("Too short");
  });

  it("a validity change re-renders the component that read it", () => {
    const { store, users } = makeStore();
    function Row({ item }: { item: any }) {
      const row = useForm(item) as any;
      return <span data-testid="v">{String(row.name.isInvalid)}|{row.name.errorMessage ?? "—"}</span>;
    }
    function List() {
      const form = useForm(store) as any;
      return <Row item={form.users.items[0]} />;
    }
    render(<List />);
    expect(screen.getByTestId("v").textContent).toBe("false|—");
    act(() => { users.items[0].name.value = ""; });
    expect(screen.getByTestId("v").textContent).toBe("true|Name?");
  });

  it("spread order: the leaf keys, dirty, loading, submitting, submit, onValueChange last", () => {
    const { users } = makeStore();
    expect(Object.keys({ ...users.items[0].plain })).toEqual([
      "value", "label", "placeholder", "description", "isRequired", "isReadOnly", "isDisabled", "isVisible",
      "isInvalid", "errorMessage", "dirty", "loading", "submitting", "submit", "onValueChange",
    ]);
  });
});
