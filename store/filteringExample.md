import type { VehicleTableType, VehicleOwnership } from "./types";
import type { VehicleFiltersState } from "./VehicleFilters/VehicleFiltersContext/types";

/**
 * Чистые функции фильтрации/сортировки таблицы машин.
 *
 * Состояние (фильтры, сортировка, страница) живёт в сторе — `vehiclesPage`,
 * здесь только преобразования массива.
 */

export const ROWS_PER_PAGE = 10;

/** Нормализация hex-кода цвета к верхнему регистру. */
function normalizeColor(color: string | null): string | null {
  if (!color) return null;

  return color.toUpperCase();
}

/**
 * Уникальные локации машин (base + currentLocation).
 */
export function extractUniqueLocations(vehicles: VehicleTableType[]): string[] {
  const locationSet = new Set<string>();

  vehicles.forEach((vehicle) => {
    if (vehicle.base) locationSet.add(vehicle.base);
    if (vehicle.currentLocation) locationSet.add(vehicle.currentLocation);
  });

  return Array.from(locationSet).sort();
}

/** Фильтр по принадлежности (own / partner / deleted). Пустой набор — всё. */
export function filterByOwnership(
  vehicles: VehicleTableType[],
  ownershipFilter: VehicleOwnership[],
): VehicleTableType[] {
  if (ownershipFilter.length === 0) return vehicles;

  return vehicles.filter((vehicle) => {
    if (ownershipFilter.includes("own") && vehicle.isOwn) return true;
    if (ownershipFilter.includes("partner") && !vehicle.isOwn) return true;
    // TODO: добавить логику для deleted когда появится поле

    return false;
  });
}

// TODO в Палистор нужно добавить фильтры в апи списков, и эта логика не понадобится.
/** Фильтр по расширенным параметрам (бренд, цвет, тип, категория, …). */
export function filterByAdvanced(
  vehicles: VehicleTableType[],
  filters: VehicleFiltersState | null,
): VehicleTableType[] {
  if (!filters) return vehicles;

  return vehicles.filter((vehicle) => {
    if (filters.brand && vehicle.brand_id !== filters.brand) return false;

    if (filters.color && normalizeColor(vehicle.color) !== normalizeColor(filters.color)) {
      return false;
    }

    if (filters.type && vehicle.type !== filters.type) return false;

    // Категория — мультиселект, достаточно пересечения
    if (filters.category && filters.category.length > 0) {
      const vehicleCategories = vehicle.category || [];
      const hasMatchingCategory = filters.category.some((filterCat) =>
        vehicleCategories.includes(filterCat),
      );

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

    // TODO: Interval filter — будет реализовано позже для проверки доступности

    return true;
  });
}

/** Фильтр по строке поиска (имя / модель / бренд / номер). */
export function filterBySearch(
  vehicles: VehicleTableType[],
  searchQuery: string,
): VehicleTableType[] {
  if (!searchQuery) return vehicles;

  const lowerFilter = searchQuery.toLowerCase();

  return vehicles.filter((vehicle) =>
    vehicle.name?.toLowerCase().includes(lowerFilter) ||
    vehicle.model?.toLowerCase().includes(lowerFilter) ||
    vehicle.brand_name?.toLowerCase().includes(lowerFilter) ||
    vehicle.plateNumber?.toLowerCase().includes(lowerFilter),
  );
}

/** Сортировка по колонке таблицы. */
export function sortVehicles(
  vehicles: VehicleTableType[],
  column: string,
  direction: "ascending" | "descending",
): VehicleTableType[] {
  return [...vehicles].sort((a, b) => {
    const first = a[column as keyof VehicleTableType];
    const second = b[column as keyof VehicleTableType];

    if (first == null && second == null) return 0;
    if (first == null) return 1;
    if (second == null) return -1;

    const cmp = first < second ? -1 : first > second ? 1 : 0;

    return direction === "descending" ? -cmp : cmp;
  });
}

/** Есть ли активные расширенные фильтры (тип не считается — у него всегда дефолт). */
export function hasActiveFilters(filters: VehicleFiltersState): boolean {
  return Object.entries(filters).some(([key, value]) => {
    if (key === "type") return false;
    if (value === null) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === "object" && "dateFrom" in value && "dateTo" in value) {
      return value.dateFrom !== null || value.dateTo !== null;
    }

    return true;
  });
}
