import type { FormConfig } from "../core/types";

// ============================================================================
// Тестовые данные это конфиг для тестирования.
// ============================================================================

/*
  System fields:
  
  value
  label
  placeholder
  description
  isRequired
  isReadOnly
  isDisabled
  isVisible

  Эти поля являются встроенными в систему,
  они всегда есть это также и резервированные слова,
  которые нельзя использовать в объектах данных.

*/

type TestValues = {
  email: string;
  paymentType: string;
  passport: {
    id: number | null;
    number: string;
    issueDate: string;
    expiryDate: string;
  };
  user: {
    id: string;
    vehicle: {
      model: string;
      brand: {
        id: string;
        name: string;
      }
      partner: {
        id: string;
        company: {
          id: string;
          name: string;
        }
      }
    }
  }
};

const testConfig: FormConfig<TestValues> = {
  email: {
    value: "",
    label: "Email",
    isRequired: true,
    validate: (value: string) => (!value ? "required" : undefined),
    dependencies: [],
  },
  paymentType: {
    value: "card",
    label: "Payment Type",
    dependencies: [],
  },
  passport: {
    nested: true,
    isVisible: (values: TestValues) => values.paymentType === "bank",
    id: {
      value: null,
      isVisible: false,
    },
    number: {
      value: "",
      label: "Passport Number",
      isRequired: true,
      validate: (value: string) => (!value ? "required" : undefined),
    },
    issueDate: {
      value: "",
      label: "Issue Date",
      isRequired: false,
    },
    expiryDate: {
      value: "",
      label: "Expiry Date",
      validate: (value: string, values: TestValues) => {
        if (value && values.passport?.issueDate && value <= values.passport.issueDate) {
          return "expiryBeforeIssue";
        }
        return undefined;
      },
    },
  },
  user: {
    id: {
      value: "User ID",
      isVisible: false,
    },
    isVisible: true,
    isRequired: true,
    vehicle: {
      model: {
        value: "Vehicle Model",
      },
      brand: {
        id: {
          value: "Vehicle Brand ID",
          isVisible: false,
        },
        value: "Vehicle Brand",
        isVisible: true,
        isRequired: true,
      },
      partner: {
        company: {
          id: {
            value: "Company ID",
            isVisible: false,
          },
          name: {
            value: "Company Name",
          },
        }
      }
    }
  }
};

/*
  Для новых сущностей у которых нет еще id,
  может быть использован особый конфиг,
  как правило, правила создания
  и правила редактирования это разные правила.

  Что я хочу вообще как работать:
  Пользователь заполнил форму, нажал сохранить,
  создалась новая сущность, и сразу встроилась в граф,
  на свое место, похоже как в граф QL

  Я хочу что бы не нужно было в каждой вложенной
  сущности использовать эффект для забора данных.

  Например есть пользователь, у него есть паспорт,
  мы получили пользователя и у него passport_id,
  Компонент паспорта получил ссылку на паспорт, и если там пусто,
  то он запрашивает данные по этому id,
  и когда данные приходят, они становятся в граф, дальше
  при смене роутов или при перерисовке компонента,
  данные уже есть, и не нужно их запрашивать.

  и все это без хуков, автоматически.

  Может быть нужно будет концепцию резольвера вводить.
  И  это избавит от необходимости в компонентах
  и хуках писать кучу логики по заполнению данных.

*/
