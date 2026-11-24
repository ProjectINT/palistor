/**
 * The store of the "Payment Form" tab. Each file spread below holds the
 * fields of one section of the form and shows one feature: conditional
 * visibility and requiredness, formatters, a setter cascade, computed values,
 * onChange, a nested group with a submit of its own.
 */

import { Palistor } from "@palistor";

import { accountType } from "./accountType";
import { address } from "./address";
import { bank } from "./bank";
import { card } from "./card";
import { checkboxes } from "./checkboxes";
import { computed } from "./computed";
import { contacts } from "./contacts";
import { crypto } from "./crypto";
import { passport } from "./passport";
import { payment } from "./payment";
import type { PaymentFormValues } from "./types";

export type { AccountType, Country, CryptoNetwork, PassportValues, PaymentFormValues, PaymentType } from "./types";

export const paymentStore = new Palistor({
  config: {
    ...payment,
    ...card,
    ...bank,
    ...passport,
    ...crypto,
    ...contacts,
    ...accountType,
    ...address,
    ...computed,
    ...checkboxes,
    // Runs only when every field is valid. A mock API: answers with the payload it got.
    onSubmit: async (values: PaymentFormValues) => values,
  },
});
