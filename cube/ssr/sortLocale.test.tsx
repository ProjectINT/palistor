/**
 * `$locale` of a sort block (experiments/SortPlan.md, risks): a client sort
 * compares strings through `Intl.Collator`, whose default locale is the
 * environment's. The server and the browser may have different ones; then
 * the server's HTML and the client's first render order non-ASCII strings
 * differently, and hydration fails. With `$locale` the order is the same
 * wherever the store is built.
 *
 * The environment's default locale is simulated: `Intl.Collator` without a
 * locale gets the one given here (the store builds its collator once, in the
 * constructor).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Palistor, defineList, useForm, type PalistorRef, type SortBlock } from "../index";

type Fruit = { id: string; title: string };

/** German puts Ä with A, Swedish after Z. */
const FRUITS: Fruit[] = [
  { id: "f1", title: "Zitrone" },
  { id: "f2", title: "Äpfel" },
  { id: "f3", title: "Mango" },
];

const RealCollator = Intl.Collator;

/** Runs `fn` as if the environment's default locale were `locale`. */
function inLocale<T>(locale: string, fn: () => T): T {
  const Collator = function (locales?: string | string[], options?: Intl.CollatorOptions) {
    return new RealCollator(locales ?? locale, options);
  } as unknown as typeof Intl.Collator;
  Object.defineProperty(Collator, "supportedLocalesOf", { value: RealCollator.supportedLocalesOf });
  Object.defineProperty(Intl, "Collator", { value: Collator, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(Intl, "Collator", { value: RealCollator, configurable: true, writable: true });
  }
}

function fruits(locale: string, sort: SortBlock<Fruit>, server = false) {
  return inLocale(locale, () => new Palistor({
    config: { fruits: defineList<Fruit>({ template: { id: { value: "" }, title: { value: "" } }, sort }) },
    initialData: { fruits: FRUITS },
    server,
  }));
}

function FruitItem({ fruit }: { fruit: PalistorRef<Fruit> }) {
  return <li>{useForm(fruit).title.value}</li>;
}

function Fruits({ store }: { store: ReturnType<typeof fruits> }) {
  const form = useForm(store);
  return <ul>{form.fruits.map((fruit, _i, id) => <FruitItem key={id} fruit={fruit} />)}</ul>;
}

describe("$locale: the same order on the server and in the browser", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let consoleError: ReturnType<typeof vi.spyOn>;
  const onRecoverableError = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    onRecoverableError.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    consoleError.mockRestore();
  });

  it("without $locale the order follows each environment's default locale", () => {
    const block: SortBlock<Fruit> = { $default: "title", title: true };
    expect(renderToString(<Fruits store={fruits("sv", block, true)} />)).toBe("<ul><li>Mango</li><li>Zitrone</li><li>Äpfel</li></ul>");
    expect(renderToString(<Fruits store={fruits("de", block, true)} />)).toBe("<ul><li>Äpfel</li><li>Mango</li><li>Zitrone</li></ul>");
  });

  it("with $locale a server on one default and a browser on another agree, and the page hydrates", async () => {
    const block: SortBlock<Fruit> = { $default: "title", $locale: "de", title: true };
    const html = renderToString(<Fruits store={fruits("sv", block, true)} />);
    expect(html).toBe("<ul><li>Äpfel</li><li>Mango</li><li>Zitrone</li></ul>");

    container.innerHTML = html;
    const sent = container.firstElementChild;
    const client = fruits("en", block);
    await act(async () => {
      root = hydrateRoot(container, <Fruits store={client} />, { onRecoverableError });
    });
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    act(() => { client.proxy.fruits.sort!.toggle("title"); }); // asc → desc, still in German order
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Zitrone", "Mango", "Äpfel"]);
  });
});
