Задача написать стейт менеджер.

1. Зачем:
  - Простое подключение компонентов к состоянию на основе интерфейсов хранилища.
  - Автоматическое обновление компонентов при изменении состояния.
  - Легкая интеграция с React.
  - Перфоманс за счет минимальных обновлений.
  - Использование существующих конфигов.
  - Централизовано управлять и рефрешить состояние когда пользователь приходит на вкладку.
  - Состояние работает с типами а не просто работает с данными.
  - Каждое поле будет типизировано, при этом тип будет управляться через id.

реализация из примера:

let state: TState
const listeners: Set<Listener> = new Set()

function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<Listener>()

  return {
    getState: () => state,

    setState: (next: T) => {
      if (Object.is(state, next)) return
      state = next
      listeners.forEach(l => l())
    },

    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

Вместо getFieldProps которые сейчас будет использоваться селектор.
Это позволит избежать лишних ререндеров.

Все поля конфига будут функциями опционально.

Важным элементом проектирования является типизация и id. 

Нам нужно что бы состояние имело внутренние методы:

- get<T>(id: string): FormState<T>
- set<T>(id: string, value: Partial<T>): void

Снаружи хочется, что бы была мутация, которая получает данные. И вся работа с состоянием происходит внутри автоматически.

const { submit, getFieldProps } = useFormStore(id, "Type")

Наружное апи:
  values
  errors
  submitting
  dirty
  submit
  reset
  validateField
  getVisibleFields
  getFieldProps
  validateForm

Сейчас нужно жестко устанавливать имена полей, что делает решение связанным с UI
Нужно просто создавать маппер.
```ts
const config = {
  /*
    Маппер позволяет создавать конфиги с любыми полями, под любые библиотеки
    В данном случае дефолтные поля, ключи это поля которые встроены в конфиги
    значения это переименованные поля конфига.
  */
  mapper: {
    value: "value",
    onValueChange: "onValueChange",
    onValuesChange: "onValuesChange",
    setValues: "setValues",
    isDisabled: "isDisabled",
    isReadOnly: "isReadOnly",
    isRequired: "isRequired",
    isInvalid: "isInvalid",
    errorMessage: "errorMessage",
    isError: "isError",
    label: "label",
    placeholder: "placeholder",
    description: "description",
    formatter: "formatter",
    setter: "setter",
  },
  initialState: {
    vehicle_photos: {
      value: (state) => [],
      isRequired: (state) => true,
      isDisabled: (state) => state.vehicle_status === "archived",
      types: {
        dataType: "Array",
        type: "VehiclePhoto[]",
      },
    },
    agencyCommission: {
      value: 0,
      label: "Orders.agencyCommission",
      description: "Orders.agencyCommissionDescription",
      validate: (value: number | null) => {
        if (value !== null && value < 0) {
          return "Validation.numberMustBePositive";
        }

        return undefined;
      },
      isDisabled: (values: OrderFormData) => {
        const disabledModes: OrderFormData["tarifficationMode"][] = [
          "MANUAL_TOTAL_PRICE",
        ];

        return disabledModes.includes(values.tarifficationMode);
      },
      isVisible: (values: OrderFormData) => {
        const hiddenModes: OrderFormData["tarifficationMode"][] = [
          "COMMISSION_ONLY",
        ];

        return !hiddenModes.includes(values.tarifficationMode);
      },
      types: {
        dataType: "number",
        type: "Float",
      }
    },
  },
}

/*
  Это все пока просто мысли. Нужно думать, выглядит очень сложно, ничего не упрощает, хотя может быть и решает задачу.

  В любом случае нужно будет менять контекст на какое то решение.
*/

// Такой вариант вместо getFieldProps

getField("vehicle_photos", VehiclePhotos)

function getField<T>(
  name: string,
  render: (props: T) => React.ReactNode
) {
  const props = this.getFieldProps<T>(name);

  return props ? render(props) : null;
}

/*
  Но лучше пусть будут дефолтные поля как сейчас
*/

/*
  Важной особенность палистор должно быть то, что в него будет встроена валидация на основе типов.
  Из переданных типов можно будет строить карту хранилища.
  Например если у нас есть тип:
*/
import type { Database } from "@projectint/types";

/**
 * Автоматический overlay: накладывает типизацию таблицы на композитный тип.
 * Берет все поля из композита, но применяет required/optional из таблицы где возможно.
 * 
 * @template TComposite - Композитный тип из базы
 * @template TTable - Тип таблицы из базы
 */
type CompositeOverlay<
  TComposite extends Record<string, any>,
  TTable extends Record<string, any>
> = {
  [K in keyof TComposite]: K extends keyof TTable
    ? TTable[K] // Поле есть в таблице - берем оттуда
    : TComposite[K]; // Поля нет в таблице (вычисляемое) - берем из композита
};

/**
 * VehicleOrderSummary со строгостью полей из таблицы orders.
 * Автоматически применяет типизацию orders ко всем совпадающим полям.
 */
export type VehicleOrderSummary = CompositeOverlay<
  Database["public"]["CompositeTypes"]["vehicle_order_summary"],
  Database["public"]["Tables"]["orders"]["Row"]
>;

/**
 * Generic фабрика для создания overlay типов
 */
export type CreateCompositeOverlay<
  TCompositeName extends keyof Database["public"]["CompositeTypes"],
  TTableName extends keyof Database["public"]["Tables"]
> = CompositeOverlay<
  Database["public"]["CompositeTypes"][TCompositeName],
  Database["public"]["Tables"][TTableName]["Row"]
>;

// Пример для других композитных типов
// export type AnotherOverlay = CreateCompositeOverlay<"another_composite", "source_table">;