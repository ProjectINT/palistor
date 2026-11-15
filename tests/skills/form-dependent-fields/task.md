# Task: delivery form

Skill under test: `palistor`.

We need the delivery step of our checkout. The project is React + TypeScript and already has
`palistor` installed. Put everything in `deliveryForm.tsx` and export two things from it:

- `deliveryStore` — the form's store;
- `DeliveryForm` — the component.

`api.ts` next to it is our backend client; call its `placeOrder(values)` to place the order and do
not change that file.

What the form does:

- **Email** — required. Stored trimmed and lower-cased; it must contain `@`.
- **Delivery** — a select with `pickup` (default) and `courier`.
- **Address** — shown only for courier delivery, and required then. Switching the delivery method
  clears whatever was typed in it.
- **Quantity** — a number input, starts at 1. The unit price is 12.5; show the total in an element
  with `data-testid="total"`.
- A **Place order** button submits the form. `placeOrder` is called only when the form is valid, with
  the form values `{ email, method, address, quantity, total }` (`method` is `"pickup"` or
  `"courier"`). `deliveryStore.getValues()` returns the same keys.
- Validation messages are not shown until the customer first tries to place the order. Render each
  message in an element with `role="alert"`.

Our UI tests find the inputs by their labels — `Email`, `Delivery`, `Address`, `Quantity` (the label
text must start with that word) — and the button by its name, `Place order`.
