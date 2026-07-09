import { getRequestConfig } from "next-intl/server";

// The demo ships as a static export (GitHub Pages), so there is no server to
// read a cookie at request time. Locale switching happens on the client (see
// providers/IntlProvider.tsx); this config only provides a static default so
// any server-side next-intl call during the build stays static-export safe.
export default getRequestConfig(async () => {
  const locale = "en";

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
