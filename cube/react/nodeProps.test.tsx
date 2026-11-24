/**
 * A node handed down as a prop and resolved with useForm(prop), level after
 * level: the component tree mirrors the config tree, and each component is
 * bound to exactly the node its parent gave it — a group, or a single field.
 *
 * The run-time rule is the contract's (cube/contract/sliceA/useForm.test.tsx,
 * "useForm(subtree) — child components with independent subscriptions"). Here:
 * the same on a `usePalistor` store, several levels deep, and the types of the
 * field overload Cube adds to `useForm` (cube/types.ts, `UseForm`).
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import {
  Palistor,
  defineFieldMapping,
  useForm,
  usePalistor,
  type FieldProxyNode,
  type PalistorProxy,
} from "../index";

interface Geo { lat: number; lng: number }
interface Address { city: string; street: string; geo: Geo }
interface Customer { name: string; address: Address }

const orderConfig = () => ({
  number: { value: "" },
  customer: {
    name: { value: "" },
    address: {
      isVisible: (values: { name: string }) => values.name !== "hidden",
      city: { value: "" },
      street: { value: "" },
      geo: { lat: { value: 0 }, lng: { value: 0 } },
    },
  },
});
type OrderConfig = ReturnType<typeof orderConfig>;

/**
 * The component tree of the README's example; `renders` counts each component
 * by the node it is on. With `guard` the address section reads a state of its
 * own node (`isVisible`).
 */
function orderForm({ guard = false }: { guard?: boolean } = {}) {
  const renders: Record<string, number> = {};
  const count = (id: string) => { renders[id] = (renders[id] ?? 0) + 1; };
  const stores: Palistor<OrderConfig>[] = [];

  // One component for any string field, at any depth: the parent picks the leaf.
  function TextField({ id, field }: { id: string; field: FieldProxyNode<string> }) {
    count(id);
    const f = useForm(field);
    return <input aria-label={id} value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
  }
  function NumberField({ id, field }: { id: string; field: FieldProxyNode<number> }) {
    count(id);
    const f = useForm(field);
    return <input aria-label={id} value={f.value} onChange={(e) => f.onValueChange(Number(e.target.value))} />;
  }
  function GeoSection({ geo }: { geo: PalistorProxy<Geo> }) {
    count("geo");
    const g = useForm(geo);
    return <><NumberField id="lat" field={g.lat} /><NumberField id="lng" field={g.lng} /></>;
  }
  function AddressSection({ address }: { address: PalistorProxy<Address> }) {
    count("address");
    const a = useForm(address);
    if (guard && !a.isVisible) return null; // reads a state of its own node
    return (
      <>
        <TextField id="city" field={a.city} />
        <TextField id="street" field={a.street} />
        <GeoSection geo={a.geo} />
      </>
    );
  }
  function CustomerSection({ customer }: { customer: PalistorProxy<Customer> }) {
    count("customer");
    const c = useForm(customer);
    return <><TextField id="name" field={c.name} /><AddressSection address={c.address} /></>;
  }
  // The root: the only component that sees the store.
  function OrderForm() {
    count("order");
    const store = usePalistor(() => ({ config: orderConfig() }));
    stores.push(store);
    const form = useForm(store);
    return <><TextField id="number" field={form.number} /><CustomerSection customer={form.customer} /></>;
  }
  return { OrderForm, renders, stores };
}

const others = (renders: Record<string, number>, ...ids: string[]) =>
  Object.fromEntries(Object.entries(renders).filter(([id]) => !ids.includes(id)));

describe("a node handed down as a prop, level after level", () => {
  it("four levels deep: an edit re-renders the component of that field and no other", () => {
    const { OrderForm, renders } = orderForm();
    const { getByLabelText } = render(<OrderForm />);
    const once = { order: 1, number: 1, customer: 1, name: 1, address: 1, city: 1, street: 1, geo: 1, lat: 1, lng: 1 };
    expect(renders).toEqual(once);

    fireEvent.change(getByLabelText("lat"), { target: { value: "55" } }); // order → customer → address → geo → lat
    expect(renders).toEqual({ ...once, lat: 2 });

    fireEvent.change(getByLabelText("city"), { target: { value: "Riga" } }); // three levels down
    expect(renders).toEqual({ ...once, lat: 2, city: 2 });

    fireEvent.change(getByLabelText("number"), { target: { value: "A-1" } }); // a leaf of the root
    expect(renders).toEqual({ ...once, lat: 2, city: 2, number: 2 });

    expect((getByLabelText("lat") as HTMLInputElement).value).toBe("55");
    expect((getByLabelText("city") as HTMLInputElement).value).toBe("Riga");
    expect((getByLabelText("number") as HTMLInputElement).value).toBe("A-1");
  });

  it("a section that reads a state of its own node follows that node's state — its `dirty` too — and its parents do not", () => {
    const { OrderForm, renders, stores } = orderForm({ guard: true });
    const { getByLabelText, queryByLabelText } = render(<OrderForm />);

    // Reading `address.isVisible` subscribes the section to the whole state of `address`. The first
    // edit below it turns `address.dirty` on: the section re-renders once, its children with it.
    fireEvent.change(getByLabelText("lat"), { target: { value: "55" } });
    expect(renders).toEqual({ order: 1, number: 1, customer: 1, name: 1, address: 2, city: 2, street: 2, geo: 2, lat: 2, lng: 2 });

    // The second edit changes no state of `address`: the field alone.
    fireEvent.change(getByLabelText("lat"), { target: { value: "56" } });
    expect(renders).toEqual({ order: 1, number: 1, customer: 1, name: 1, address: 2, city: 2, street: 2, geo: 2, lat: 3, lng: 2 });

    // `address.isVisible` is computed from `customer.name`: a write from outside React hides the section.
    act(() => { stores[0].proxy.customer.name.value = "hidden"; });
    expect(queryByLabelText("city")).toBeNull();
    expect(renders.address).toBe(3);
    expect(others(renders, "address", "name")).toEqual({ order: 1, number: 1, customer: 1, city: 2, street: 2, geo: 2, lat: 3, lng: 2 });
  });

  it("the node in the prop carries its store: two instances of the tree never meet", () => {
    const { OrderForm, stores } = orderForm();
    const { getAllByLabelText } = render(<><OrderForm /><OrderForm /></>);
    const [first, second] = getAllByLabelText("city") as HTMLInputElement[];

    fireEvent.change(first, { target: { value: "Riga" } });

    expect(first.value).toBe("Riga");
    expect(second.value).toBe("");
    expect(stores[0]).not.toBe(stores[1]);
    expect(stores[0].getValues().customer.address.city).toBe("Riga");
    expect(stores[1].getValues().customer.address.city).toBe("");
  });

  it("a raw leaf of store.proxy is refused like a raw group", () => {
    const store = new Palistor({ config: orderConfig() });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      // @ts-expect-error a leaf of store.proxy is as raw as a group of it
      renderHook(() => useForm(store.proxy.number));
    }).toThrow("useForm: received a raw store proxy node");
    consoleError.mockRestore();
  });
});

// ─── Types ────────────────────────────────────────────────────────────────────
// Checked by `npm run typecheck:cube`; never called (the hooks inside need no renderer).

function TypeLevel({ customer, field, loose }: { customer: PalistorProxy<Customer>; field: FieldProxyNode<string>; loose: any }): null {
  // ── A field in, the same field out.
  const leaf = useForm(field);
  const text: string = leaf.value;
  leaf.onValueChange("x");
  // @ts-expect-error the value type of the leaf is kept
  leaf.onValueChange(1);

  // ── The store's overloads still answer first.
  const store = new Palistor({ config: orderConfig() });
  const root = useForm(store);
  const group = useForm(customer);
  const city: string = group.address.city.value;

  // ── Level after level without a cast: each node is assignable to the next component's prop.
  const address: PalistorProxy<Address> = group.address;
  const geo: PalistorProxy<Geo> = useForm(address).geo;
  const lat: FieldProxyNode<number> = useForm(geo).lat;
  const latValue: number = useForm(lat).value;
  // A leaf of the config-typed root is a FieldProxyNode too.
  const number: FieldProxyNode<string> = root.number;
  const fromRoot: string = useForm(root.customer.address.city).value;

  // ── An `any` argument resolves as before the field overload (the store's first overload).
  const anything: string = useForm(loose).whatever.value;

  // ── Raw nodes stay forbidden, a group as well as a leaf.
  // @ts-expect-error store.proxy.<group>
  useForm(store.proxy.customer);
  // @ts-expect-error store.proxy.<leaf>
  useForm(store.proxy.number);

  // ── Known gap: a leaf of a mapped store is not a FieldProxyNode (works at run time).
  const mapped = new Palistor({ config: { email: { value: "", required: true } }, fieldMapping: defineFieldMapping({ isRequired: "required" }) });
  const mappedRoot = useForm(mapped);
  const required: boolean = mappedRoot.email.required;
  // @ts-expect-error not typed yet: the mapped leaf has `required`, FieldProxyNode has `isRequired`
  useForm(mappedRoot.email);

  void [text, city, latValue, number, fromRoot, anything, required];
  return null;
}
void TypeLevel;
