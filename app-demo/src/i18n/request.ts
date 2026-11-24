import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, MESSAGES, TIME_ZONE } from "./locale";

// Required by the next-intl plugin (next.config.ts). A static export has no
// request to read the locale cookie from, so the server side always renders
// the default locale; IntlProvider switches to the saved one on the client.
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  messages: MESSAGES[DEFAULT_LOCALE],
  timeZone: TIME_ZONE,
}));
