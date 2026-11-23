/** Stand-in for the app's i18n library: `useT()` returns the translation function of the current locale. */
export type Translate = (key: string) => string;

const messages: Record<string, string> = {
  "customers.search": "Search customers",
};

const translate: Translate = (key) => messages[key] ?? key;

/** Works on the server and in the browser, and returns the same function on every render. */
export function useT(): Translate {
  return translate;
}
