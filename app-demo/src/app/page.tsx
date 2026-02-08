"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback } from "react";

import { useFormStoreWithTranslate } from "@/hooks/useFormStoreWithTranslate";
import { useFormStore } from "@palistor/react/useFormStore";
import { useFieldState, useFieldValue, useFieldVisible, useFieldError } from "@palistor/react/useField";
import type { TranslateFn } from "@palistor/core/types";

import { Input, Select, Checkbox, Button } from "@/components/ui";
import {
  paymentFormConfig,
  paymentFormDefaults,
  type PaymentFormValues,
  type PaymentType,
  type Country,
  type CryptoNetwork,
  type AccountType,
} from "@/config/paymentForm";

// ============================================================================
// Константы для select options
// ============================================================================

const PAYMENT_TYPE_OPTIONS = [
  { value: "card", label: "paymentTypes.card" },
  { value: "bank", label: "paymentTypes.bank" },
  { value: "crypto", label: "paymentTypes.crypto" },
];

const CRYPTO_NETWORK_OPTIONS = [
  { value: "ethereum", label: "networks.ethereum" },
  { value: "bitcoin", label: "networks.bitcoin" },
  { value: "tron", label: "networks.tron" },
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: "personal", label: "accountTypes.personal" },
  { value: "business", label: "accountTypes.business" },
];

const COUNTRY_OPTIONS = [
  { value: "ru", label: "countries.ru" },
  { value: "us", label: "countries.us" },
  { value: "de", label: "countries.de" },
];

const CITIES_BY_COUNTRY: Record<Country, { value: string; label: string }[]> = {
  ru: [
    { value: "moscow", label: "cities.moscow" },
    { value: "spb", label: "cities.spb" },
    { value: "kazan", label: "cities.kazan" },
  ],
  us: [
    { value: "newyork", label: "cities.newyork" },
    { value: "losangeles", label: "cities.losangeles" },
  ],
  de: [
    { value: "berlin", label: "cities.berlin" },
    { value: "munich", label: "cities.munich" },
  ],
};

// ============================================================================
// Демо страница
// ============================================================================

export default function DemoPage() {
  const t = useTranslations();
  const [activeTab, setActiveTab] = useState<"form" | "hooks" | "debug">("form");
  const [locale, setLocale] = useState<"ru" | "en">("ru");

  // Создаём TranslateFn из next-intl
  const translate: TranslateFn = useCallback(
    (key: string, params?: Record<string, any>) => {
      try {
        return t(key, params);
      } catch {
        return key;
      }
    },
    [t]
  );

  // Основная форма
  const form = useFormStoreWithTranslate<PaymentFormValues>("payment-demo", {
    config: paymentFormConfig,
    defaults: paymentFormDefaults,
    translate,
    persistId: "demo-payment-draft", // Сохраняет черновик в localStorage
    locale,
    onChange: ({ fieldKey, newValue, previousValue }) => {
      console.log(`[onChange] ${String(fieldKey)}: ${previousValue} → ${newValue}`);
    },
    onSubmit: async (values) => {
      console.log("[onSubmit] Submitting form with values:", values);
      // Имитация отправки
      await new Promise((resolve) => setTimeout(resolve, 2000));
      alert("Форма успешно отправлена!");
    },
    afterSubmit: (data, reset) => {
      console.log("[afterSubmit] Form submitted, data:", data);
      // Можно вызвать reset() здесь
    },
  });

  // Переключение локали
  const handleLocaleChange = (newLocale: "ru" | "en") => {
    setLocale(newLocale);
    form.setLocale(newLocale);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {t("demo.title")}
              </h1>
              <p className="text-zinc-600 dark:text-zinc-400 mt-1">
                {t("demo.subtitle")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant={locale === "ru" ? "primary" : "secondary"}
                size="sm"
                onClick={() => handleLocaleChange("ru")}
              >
                🇷🇺 RU
              </Button>
              <Button
                variant={locale === "en" ? "primary" : "secondary"}
                size="sm"
                onClick={() => handleLocaleChange("en")}
              >
                🇺🇸 EN
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
            {(["form", "hooks", "debug"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  px-4 py-2 font-medium transition-colors border-b-2 -mb-px
                  ${activeTab === tab
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }
                `}
              >
                {t(`demo.tabs.${tab === "form" ? "payment" : tab === "hooks" ? "user" : "debug"}`)}
              </button>
            ))}
          </div>
        </header>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-2">
            {activeTab === "form" && (
              <FormSection form={form} t={t} locale={locale} />
            )}
            {activeTab === "hooks" && (
              <HooksDemo formId="payment-demo" t={t} />
            )}
            {activeTab === "debug" && (
              <DebugPanel form={form} t={t} />
            )}
          </div>

          {/* State Preview */}
          <div className="lg:col-span-1">
            <StatePreview form={form} t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Form Section — основная форма
// ============================================================================

interface FormSectionProps {
  form: ReturnType<typeof useFormStore<PaymentFormValues>>;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}

function FormSection({ form, t, locale }: FormSectionProps) {
  const { fields, getFieldProps, setValue, submit, reset, submitting, dirty } = form;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-6"
      >
        {/* Payment Type */}
        <Section title="Способ оплаты">
          <Select
            {...getFieldProps("paymentType")}
            options={PAYMENT_TYPE_OPTIONS.map((o) => ({
              ...o,
              label: t(o.label),
            }))}
            onValueChange={(v) => setValue("paymentType", v as PaymentType)}
          />
        </Section>

        {/* Card Fields */}
        {fields.cardNumber.isVisible && (
          <Section title="Данные карты">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-3">
                <Input {...getFieldProps("cardNumber")} />
              </div>
              <Input {...getFieldProps("cardExpiry")} />
              <Input {...getFieldProps("cardCvv")} />
            </div>
          </Section>
        )}

        {/* Bank Fields */}
        {fields.bankAccount.isVisible && (
          <Section title="Банковский перевод">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input {...getFieldProps("bankAccount")} />
              <Input {...getFieldProps("bankBik")} />
            </div>
          </Section>
        )}

        {/* Crypto Fields */}
        {fields.cryptoWallet.isVisible && (
          <Section title="Криптовалюта">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input {...getFieldProps("cryptoWallet")} />
              <Select
                {...getFieldProps("cryptoNetwork")}
                options={CRYPTO_NETWORK_OPTIONS.map((o) => ({
                  ...o,
                  label: t(o.label),
                }))}
                onValueChange={(v) => setValue("cryptoNetwork", v as CryptoNetwork)}
              />
            </div>
          </Section>
        )}

        {/* Amount */}
        <Section title="Сумма">
          <Input
            {...getFieldProps("amount")}
            type="number"
          />
        </Section>

        {/* Contact Info */}
        <Section title="Контактные данные">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input {...getFieldProps("name")} />
            <Input {...getFieldProps("email")} type="email" />
            <div className="md:col-span-2">
              <Input {...getFieldProps("phone")} type="tel" />
            </div>
          </div>
        </Section>

        {/* Account Type */}
        <Section title="Тип аккаунта">
          <div className="space-y-4">
            <Select
              {...getFieldProps("accountType")}
              options={ACCOUNT_TYPE_OPTIONS.map((o) => ({
                ...o,
                label: t(o.label),
              }))}
              onValueChange={(v) => setValue("accountType", v as AccountType)}
            />
            {fields.companyName.isVisible && (
              <Input {...getFieldProps("companyName")} />
            )}
          </div>
        </Section>

        {/* Address — Cascading Dependencies Demo */}
        <Section title="Адрес доставки (демо каскадных зависимостей)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select
              {...getFieldProps("country")}
              options={COUNTRY_OPTIONS.map((o) => ({
                ...o,
                label: t(o.label),
              }))}
            />
            {fields.city.isVisible && (
              <Select
                {...getFieldProps("city")}
                options={
                  form.values.country
                    ? (CITIES_BY_COUNTRY[form.values.country] ?? []).map((o) => ({
                        ...o,
                        label: t(o.label),
                      }))
                    : []
                }
              />
            )}
            {fields.shippingCost.isVisible && (
              <Input
                {...getFieldProps("shippingCost")}
              />
            )}
          </div>
        </Section>

        {/* Calculator — Computed Values Demo */}
        <Section title="Калькулятор (демо computed values)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              {...getFieldProps("price")}
            />
            <Input
              {...getFieldProps("quantity")}
            />
            <Input
              {...getFieldProps("total")}
            />
          </div>
        </Section>

        {/* Checkboxes */}
        <Section title="Соглашения">
          <div className="space-y-3">
            <Checkbox
              {...getFieldProps("agreeTerms")}
            />
            <Checkbox
              {...getFieldProps("newsletter")}
            />
          </div>
        </Section>

        {/* Comment */}
        <Section title="Комментарий">
          <Input {...getFieldProps("comment")} />
        </Section>

        {/* Actions */}
        <div className="flex gap-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <Button type="submit" isLoading={submitting}>
            {t("buttons.pay")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => reset()}>
            {t("buttons.reset")}
          </Button>
          {dirty && (
            <span className="flex items-center text-sm text-amber-600 dark:text-amber-400">
              ⚠️ Есть несохранённые изменения
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// Hooks Demo — демонстрация отдельных хуков
// ============================================================================

interface HooksDemoProps {
  formId: string;
  t: ReturnType<typeof useTranslations>;
}

function HooksDemo({ formId, t }: HooksDemoProps) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        Демонстрация хуков для отдельных полей
      </h2>

      <div className="space-y-4">
        <FieldStateDemo formId={formId} fieldKey="paymentType" />
        <FieldValueDemo formId={formId} fieldKey="cardNumber" />
        <FieldVisibleDemo formId={formId} fieldKey="cardNumber" />
        <FieldErrorDemo formId={formId} fieldKey="email" />
      </div>
    </div>
  );
}

function FieldStateDemo({ formId, fieldKey }: { formId: string; fieldKey: string }) {
  const field = useFieldState(formId, fieldKey);
  return (
    <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100 mb-2">
        useFieldState(&quot;{fieldKey}&quot;)
      </h3>
      <pre className="text-xs text-zinc-600 dark:text-zinc-400 overflow-auto">
        {JSON.stringify(field, null, 2)}
      </pre>
    </div>
  );
}

function FieldValueDemo({ formId, fieldKey }: { formId: string; fieldKey: string }) {
  const value = useFieldValue(formId, fieldKey);
  return (
    <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
      <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
        useFieldValue(&quot;{fieldKey}&quot;)
      </h3>
      <p className="text-sm text-blue-700 dark:text-blue-300">
        Value: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{JSON.stringify(value)}</code>
      </p>
    </div>
  );
}

function FieldVisibleDemo({ formId, fieldKey }: { formId: string; fieldKey: string }) {
  const isVisible = useFieldVisible(formId, fieldKey);
  return (
    <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
      <h3 className="font-medium text-green-900 dark:text-green-100 mb-2">
        useFieldVisible(&quot;{fieldKey}&quot;)
      </h3>
      <p className="text-sm text-green-700 dark:text-green-300">
        isVisible: <span className={isVisible ? "text-green-600" : "text-red-600"}>{String(isVisible)}</span>
      </p>
    </div>
  );
}

function FieldErrorDemo({ formId, fieldKey }: { formId: string; fieldKey: string }) {
  const error = useFieldError(formId, fieldKey);
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
      <h3 className="font-medium text-red-900 dark:text-red-100 mb-2">
        useFieldError(&quot;{fieldKey}&quot;)
      </h3>
      <p className="text-sm text-red-700 dark:text-red-300">
        Error: {error ? <code className="bg-red-100 dark:bg-red-800 px-1 rounded">{error}</code> : "—"}
      </p>
    </div>
  );
}

// ============================================================================
// Debug Panel
// ============================================================================

interface DebugPanelProps {
  form: ReturnType<typeof useFormStore<PaymentFormValues>>;
  t: ReturnType<typeof useTranslations>;
}

function DebugPanel({ form, t }: DebugPanelProps) {
  const { values, fields, errors, dirty, submitting } = form;
  const visibleFields = form.getVisibleFields();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {t("debug.stateTitle")}
      </h2>

      {/* Meta */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t("debug.metaTitle")}
        </h3>
        <div className="flex gap-4 flex-wrap">
          <Badge color={dirty ? "amber" : "zinc"}>
            dirty: {String(dirty)}
          </Badge>
          <Badge color={submitting ? "blue" : "zinc"}>
            submitting: {String(submitting)}
          </Badge>
          <Badge color="green">
            visibleFields: {visibleFields.length}
          </Badge>
        </div>
      </div>

      {/* Visible Fields */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          getVisibleFields()
        </h3>
        <div className="flex gap-2 flex-wrap">
          {visibleFields.map((key) => (
            <Badge key={key} color="blue">{key}</Badge>
          ))}
        </div>
      </div>

      {/* Errors */}
      {Object.keys(errors).length > 0 && (
        <div>
          <h3 className="font-medium text-red-700 dark:text-red-300 mb-2">
            {t("debug.errorsTitle")}
          </h3>
          <pre className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg overflow-auto">
            {JSON.stringify(errors, null, 2)}
          </pre>
        </div>
      )}

      {/* Field States */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t("debug.fieldsTitle")} (ComputedFieldState)
        </h3>
        <div className="max-h-96 overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(fields, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// State Preview — боковая панель
// ============================================================================

interface StatePreviewProps {
  form: ReturnType<typeof useFormStore<PaymentFormValues>>;
  t: ReturnType<typeof useTranslations>;
}

function StatePreview({ form, t }: StatePreviewProps) {
  const { values, errors, dirty, submitting } = form;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 sticky top-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
        {t("debug.valuesTitle")}
      </h2>

      <div className="space-y-4">
        {/* Status */}
        <div className="flex gap-2 flex-wrap">
          {dirty && <Badge color="amber">Dirty</Badge>}
          {submitting && <Badge color="blue">Submitting...</Badge>}
          {Object.keys(errors).length > 0 && (
            <Badge color="red">{Object.keys(errors).length} errors</Badge>
          )}
        </div>

        {/* Values */}
        <div className="max-h-[60vh] overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(values, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Badge({ 
  children, 
  color = "zinc" 
}: { 
  children: React.ReactNode; 
  color?: "zinc" | "blue" | "green" | "red" | "amber" 
}) {
  const colors = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    green: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    red: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}
