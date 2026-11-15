import type { FormEvent } from "react";
import { Palistor, useForm } from "palistor";
import type { FieldProxyNode } from "palistor";
import { placeOrder } from "./api";

const UNIT_PRICE = 12.5;

type Method = "pickup" | "courier";

/** The form's values: what top-level callbacks receive and what placeOrder gets. */
interface DeliveryValues {
  email: string;
  method: Method;
  address: string;
  quantity: number;
  total: number;
}

export const deliveryStore = new Palistor({
  config: {
    email: {
      value: "",
      label: "Email",
      isRequired: true,
      formatter: (raw: unknown) => String(raw).trim().toLowerCase(),
      validate: (value: string) => (value.includes("@") ? undefined : "Enter a valid email"),
    },
    method: {
      value: "pickup" as Method,
      label: "Delivery",
      setter: () => ({ address: "" }),
    },
    address: {
      value: "",
      label: "Address",
      // Hidden fields are still validated: the same predicate drives both flags.
      isVisible: (values: DeliveryValues) => values.method === "courier",
      isRequired: (values: DeliveryValues) => values.method === "courier",
    },
    quantity: {
      value: 1,
      label: "Quantity",
      formatter: (raw: unknown) => Number(raw) || 0, // the input yields a string
    },
    total: { value: (values: DeliveryValues) => values.quantity * UNIT_PRICE },
    onSubmit: (values: DeliveryValues) => placeOrder({ ...values }),
  },
});

function TextField({ isVisible, label, value, onValueChange, isRequired, isInvalid, errorMessage }: FieldProxyNode<string>) {
  if (!isVisible) return null;
  return (
    <label>
      {label}
      {isRequired ? " *" : null}
      <input value={value} onChange={(e) => onValueChange(e.target.value)} />
      {isInvalid ? <em role="alert">{errorMessage}</em> : null}
    </label>
  );
}

function NumberField({ isVisible, label, value, onValueChange }: FieldProxyNode<number>) {
  if (!isVisible) return null;
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(e) => onValueChange(e.target.value)} />
    </label>
  );
}

export function DeliveryForm() {
  const form = useForm(deliveryStore);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await form.submit();
    } catch {
      // placeOrder failed: the form keeps its values for another attempt
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <TextField {...form.email} />
      <label>
        {form.method.label}
        <select value={form.method.value} onChange={(e) => form.method.onValueChange(e.target.value as Method)}>
          <option value="pickup">Pickup</option>
          <option value="courier">Courier</option>
        </select>
      </label>
      <TextField {...form.address} />
      <NumberField {...form.quantity} />
      <output data-testid="total">{form.total.value}</output>
      <button type="submit" disabled={form.submitting}>
        Place order
      </button>
    </form>
  );
}
