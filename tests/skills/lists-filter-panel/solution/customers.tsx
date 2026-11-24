import { defineList, Palistor, useForm } from "palistor";
import type { FieldProxyNode, FilterProxyNode, PalistorList, PalistorRef } from "palistor";
import { fetchCustomers, type Customer } from "./api";

const ROLES = ["admin", "editor", "viewer"];

const customers = defineList<Customer>({
  template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
  filter: {
    $apply: "manual", // the fields are a draft: the list and the server follow them on filter.apply() only
    search: "",
    role: "",
  },
  resolve: {
    pagination: { pageSize: 5 },
    resolver: async (values, store, ctx) => {
      const page = ctx.page!;
      const { search, role } = ctx.filter.params as { search: string; role: string }; // the applied values
      const result = await fetchCustomers({ search, role, offset: page.offset, limit: page.pageSize });
      return { items: result.rows, total: result.total };
    },
  },
});

export const customersStore = new Palistor({ config: { customers } });

export function CustomersScreen() {
  const list = useForm(customersStore).customers;
  return (
    <div>
      <FilterPanel filter={list.filter!} />
      <CustomerList customers={list} />
    </div>
  );
}

function FilterPanel({ filter }: { filter: FilterProxyNode }) {
  const f = useForm(filter);
  return (
    // A form with a submit button: Enter in the search box applies too.
    <form onSubmit={(event) => { event.preventDefault(); f.apply(); }}>
      <TextField label="Search" field={f.search} />
      <SelectField label="Role" field={f.role} />
      <button type="submit" disabled={!f.isDraft}>Apply</button>
      <button type="button" disabled={!f.isDraft} onClick={() => f.revert()}>Cancel</button>
      {f.isActive && <span>Filters: {f.activeCount}</span>}
    </form>
  );
}

function TextField({ label, field }: { label: string; field: FieldProxyNode<string> }) {
  const f = useForm(field); // shows the draft
  return <input aria-label={label} value={f.value} onChange={(event) => f.onValueChange(event.target.value)} />;
}

function SelectField({ label, field }: { label: string; field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return (
    <select aria-label={label} value={f.value} onChange={(event) => f.onValueChange(event.target.value)}>
      <option value="">Any role</option>
      {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
    </select>
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
