import { Palistor } from "palistor";
import { placeOrder } from "./api";

// TODO: the delivery form — see task.md.

export const deliveryStore = new Palistor({
  config: {
    onSubmit: (values: Record<string, unknown>) => placeOrder(values),
  },
});

export function DeliveryForm() {
  return null;
}
