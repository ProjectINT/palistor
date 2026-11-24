// Mistake: "An Apply button over automatic fields" (skills/palistor-lists/references/filtering.md). The filter
// block has no `$apply`, so its fields are automatic: every edit reaches the server after the debounce, and
// Apply sends one request more. Cancel resets to the defaults instead of the applied values.
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorList, PalistorRef } from "palistor";
import { fetchCustomers, type Customer } from "./api";

const ROLES = ["admin", "editor", "viewer"];

const customers = defineList<Customer>({
  template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
  filter: {
    search: { value: "", debounce: 300 },
    role: "",
  },
  resolve: {
    pagination: { pageSize: 5 },
    resolver: async (values, store, ctx) => {
      const page = ctx.page!;
      const { search, role } = ctx.filter.params as { search: string; role: string };
      const result = await fetchCustomers({ search, role, offset: page.offset, limit: page.pageSize });
      return { items: result.rows, total: result.total };
    },
  },
});

export const customersStore = new Palistor({ config: { customers } });

export function CustomersScreen() {
  const list = useForm(customersStore).customers;
  const f = list.filter!;
  return (
    <div>
      <form onSubmit={(event) => { event.preventDefault(); list.refetch?.(); }}>
        <input aria-label="Search" value={f.search.value} onChange={(event) => f.search.onValueChange(event.target.value)} />
        <select aria-label="Role" value={f.role.value} onChange={(event) => f.role.onValueChange(event.target.value)}>
          <option value="">Any role</option>
          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <button type="submit">Apply</button>
        <button type="button" onClick={() => f.reset()}>Cancel</button>
        {f.isActive && <span>Filters: {f.activeCount}</span>}
      </form>
      <CustomerList customers={list} />
    </div>
  );
}

function CustomerList({ customers }: { customers: PalistorList<Customer> }) {
  const list = useForm(customers);
  return (
    <div>
      {list.isInitialLoading ? (
        <p>Loading customers…</p>
      ) : (
        <ul>{list.map((customer, index, id) => <CustomerItem key={id} customer={customer} />)}</ul>
      )}
      <button disabled={!list.hasPrevPage} onClick={list.prevPage}>Previous</button>
      <span>Page {list.page} of {list.pageCount}</span>
      <button disabled={!list.hasNextPage} onClick={list.nextPage}>Next</button>
    </div>
  );
}

function CustomerItem({ customer }: { customer: PalistorRef<Customer> }) {
  return <li>{useForm(customer).name.value}</li>;
}
