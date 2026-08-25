/**
 * Port of `store/filteringExample.md` to the filter API — the integration test
 * FilteringPlan.md names as the acceptance criterion for deleting that file.
 *
 * The original consumer kept filter state outside the store and applied pure
 * functions (filterByOwnership / filterByAdvanced / filterBySearch +
 * hasActiveFilters) to the resolved array. Here the same rules are an
 * all-`where` filter block, and the assertions compare the store's visible set
 * against the original pure functions over the same fixture, permutation by
 * permutation. Every `if (!filter) return items` guard, empty-array early
 * return and the hand-written hasActiveFilters disappear — emptiness is
 * decided once by the engine and exposed as `filter.isActive`.
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "./defineList";
import type { ListResolver } from "./store/types";
import { Palistor } from "./store";

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

// ─── Fixture ─────────────────────────────────────────────────────────────────

interface VehicleRow {
  id: string;
  name: string;
  model: string;
  brand_id: string;
  brand_name: string;
  plateNumber: string;
  color: string | null;
  type: string;
  category: string[];
  year: number | null;
  transmission: string;
  fuelType: string;
  base: string | null;
  currentLocation: string | null;
  isOwn: boolean;
}

const FIXTURE: VehicleRow[] = [
  { id: "v1", name: "Falcon", model: "F1", brand_id: "bmw", brand_name: "BMW", plateNumber: "AA111", color: "#FF0000", type: "car", category: ["suv"], year: 2020, transmission: "auto", fuelType: "petrol", base: "Riga", currentLocation: "Riga", isOwn: true },
  { id: "v2", name: "Eagle", model: "E2", brand_id: "audi", brand_name: "Audi", plateNumber: "BB222", color: "#ff0000", type: "car", category: ["sedan", "family"], year: 2021, transmission: "manual", fuelType: "diesel", base: "Vilnius", currentLocation: null, isOwn: false },
  { id: "v3", name: "Hawk", model: "H3", brand_id: "bmw", brand_name: "BMW", plateNumber: "CC333", color: "#00FF00", type: "van", category: ["cargo"], year: 2019, transmission: "auto", fuelType: "electric", base: "Riga", currentLocation: "Tallinn", isOwn: true },
  { id: "v4", name: "Falconet", model: "F4", brand_id: "vw", brand_name: "VW", plateNumber: "DD444", color: null, type: "car", category: [], year: null, transmission: "auto", fuelType: "petrol", base: null, currentLocation: "Vilnius", isOwn: false },
];

// ─── Original pure functions (verbatim logic from filteringExample.md) ───────

type Ownership = "own" | "partner";

interface FiltersState {
  brand: string | null;
  color: string | null;
  type: string | null;
  category: string[];
  year: number | null;
  transmission: string | null;
  fuel: string | null;
  locations: string[];
}

function normalizeColor(color: string | null): string | null {
  if (!color) return null;
  return color.toUpperCase();
}

function filterByOwnership(vehicles: VehicleRow[], ownershipFilter: Ownership[]): VehicleRow[] {
  if (ownershipFilter.length === 0) return vehicles;
  return vehicles.filter((vehicle) => {
    if (ownershipFilter.includes("own") && vehicle.isOwn) return true;
    if (ownershipFilter.includes("partner") && !vehicle.isOwn) return true;
    return false;
  });
}

function filterByAdvanced(vehicles: VehicleRow[], filters: FiltersState | null): VehicleRow[] {
  if (!filters) return vehicles;
  return vehicles.filter((vehicle) => {
    if (filters.brand && vehicle.brand_id !== filters.brand) return false;
    if (filters.color && normalizeColor(vehicle.color) !== normalizeColor(filters.color)) return false;
    if (filters.type && vehicle.type !== filters.type) return false;
    if (filters.category && filters.category.length > 0) {
      const vehicleCategories = vehicle.category || [];
      const hasMatchingCategory = filters.category.some((c) => vehicleCategories.includes(c));
      if (!hasMatchingCategory) return false;
    }
    if (filters.year && vehicle.year !== filters.year) return false;
    if (filters.transmission && vehicle.transmission !== filters.transmission) return false;
    if (filters.fuel && vehicle.fuelType !== filters.fuel) return false;
    if (filters.locations && filters.locations.length > 0) {
      const hasMatchingLocation = filters.locations.some(
        (loc) => vehicle.base === loc || vehicle.currentLocation === loc,
      );
      if (!hasMatchingLocation) return false;
    }
    return true;
  });
}

function filterBySearch(vehicles: VehicleRow[], searchQuery: string): VehicleRow[] {
  if (!searchQuery) return vehicles;
  const lowerFilter = searchQuery.toLowerCase();
  return vehicles.filter(
    (vehicle) =>
      vehicle.name?.toLowerCase().includes(lowerFilter) ||
      vehicle.model?.toLowerCase().includes(lowerFilter) ||
      vehicle.brand_name?.toLowerCase().includes(lowerFilter) ||
      vehicle.plateNumber?.toLowerCase().includes(lowerFilter),
  );
}

function referencePipeline(
  vehicles: VehicleRow[],
  ownership: Ownership[],
  advanced: FiltersState | null,
  search: string,
): string[] {
  return filterBySearch(filterByAdvanced(filterByOwnership(vehicles, ownership), advanced), search)
    .map((v) => v.id);
}

// ─── The same rules as an all-`where` filter block ───────────────────────────

function makeStore() {
  const resolver = vi.fn<ListResolver<VehicleRow>>(async () => FIXTURE);
  const store = new Palistor({
    config: {
      vehicles: defineList<VehicleRow>({
        template: {
          id: { value: "" },
          name: { value: "" },
          model: { value: "" },
          brand_id: { value: "" },
          brand_name: { value: "" },
          plateNumber: { value: "" },
          color: { value: "" },
          type: { value: "" },
          category: { value: [] as string[] },
          year: { value: 0 },
          transmission: { value: "" },
          fuelType: { value: "" },
          base: { value: "" },
          currentLocation: { value: "" },
          isOwn: { value: false },
        },
        filter: {
          ownership: {
            value: [] as Ownership[],
            where: (v: any, own: Ownership[]) =>
              (own.includes("own") && v.isOwn === true) ||
              (own.includes("partner") && v.isOwn !== true),
          },
          brand: { value: null as string | null, where: (v: any, b: string) => v.brand_id === b },
          color: {
            value: null as string | null,
            where: (v: any, c: string) => normalizeColor(v.color) === normalizeColor(c),
          },
          type: { value: null as string | null, where: (v: any, t: string) => v.type === t },
          category: {
            value: [] as string[],
            where: (v: any, cats: string[]) => cats.some((c) => (v.category ?? []).includes(c)),
          },
          year: { value: null as number | null, where: (v: any, y: number) => v.year === y },
          transmission: {
            value: null as string | null,
            where: (v: any, t: string) => v.transmission === t,
          },
          fuel: { value: null as string | null, where: (v: any, f: string) => v.fuelType === f },
          locations: {
            value: [] as string[],
            where: (v: any, locs: string[]) =>
              locs.some((loc) => v.base === loc || v.currentLocation === loc),
          },
          search: {
            value: "",
            where: (v: any, q: string) => {
              const lower = q.toLowerCase();
              return [v.name, v.model, v.brand_name, v.plateNumber].some((s) =>
                String(s ?? "").toLowerCase().includes(lower),
              );
            },
          },
        },
        resolve: { resolver },
      }),
    },
  });
  return { store, resolver };
}

const EMPTY_ADVANCED: FiltersState = {
  brand: null,
  color: null,
  type: null,
  category: [],
  year: null,
  transmission: null,
  fuel: null,
  locations: [],
};

// ─── Assertions ──────────────────────────────────────────────────────────────

describe("filteringExample port (all-where block)", () => {
  const PERMUTATIONS: Array<{
    label: string;
    ownership: Ownership[];
    advanced: Partial<FiltersState>;
    search: string;
  }> = [
    { label: "no filters", ownership: [], advanced: {}, search: "" },
    { label: "search by name fragment", ownership: [], advanced: {}, search: "falcon" },
    { label: "search by plate", ownership: [], advanced: {}, search: "bb2" },
    { label: "ownership own", ownership: ["own"], advanced: {}, search: "" },
    { label: "ownership partner", ownership: ["partner"], advanced: {}, search: "" },
    { label: "ownership both", ownership: ["own", "partner"], advanced: {}, search: "" },
    { label: "brand", ownership: [], advanced: { brand: "bmw" }, search: "" },
    { label: "color case-insensitive", ownership: [], advanced: { color: "#ff0000" }, search: "" },
    { label: "type", ownership: [], advanced: { type: "van" }, search: "" },
    { label: "category intersection", ownership: [], advanced: { category: ["family", "cargo"] }, search: "" },
    { label: "year", ownership: [], advanced: { year: 2020 }, search: "" },
    { label: "transmission + fuel", ownership: [], advanced: { transmission: "auto", fuel: "petrol" }, search: "" },
    { label: "locations base-or-current", ownership: [], advanced: { locations: ["Riga", "Vilnius"] }, search: "" },
    { label: "everything at once", ownership: ["own"], advanced: { brand: "bmw", locations: ["Riga"] }, search: "f" },
  ];

  it("matches the original pure functions on every permutation and never issues a request", async () => {
    const { store, resolver } = makeStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);

    for (const { label, ownership, advanced, search } of PERMUTATIONS) {
      const full: FiltersState = { ...EMPTY_ADVANCED, ...advanced };
      list.filter.set({
        ownership,
        brand: full.brand,
        color: full.color,
        type: full.type,
        category: full.category,
        year: full.year,
        transmission: full.transmission,
        fuel: full.fuel,
        locations: full.locations,
        search,
      });

      const expected = referencePipeline(FIXTURE, ownership, full, search);
      expect(list.values.map((v: any) => v.id), label).toEqual(expected);
      expect(list.length, label).toBe(expected.length);
      expect(list.fullLength, label).toBe(FIXTURE.length);
      expect(list.dirty, label).toBe(false);
    }

    // an all-`where` block: serverKey is constant → zero requests, ever
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("filter.isActive replaces the hand-written hasActiveFilters", async () => {
    const { store } = makeStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    expect(list.filter.isActive).toBe(false);
    list.filter.brand.value = "bmw";
    expect(list.filter.isActive).toBe(true);
    expect(list.filter.activeCount).toBe(1);
    list.filter.clear();
    expect(list.filter.isActive).toBe(false);
  });
});
