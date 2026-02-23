/**
 * createForm — устаревший API (заменён createProxyStore + useForm).
 *
 * @deprecated Используйте createProxyStore из store/store.ts
 * и useForm из react/useForm.ts
 */

export type CreateFormConfig<_TValues extends Record<string, any> = Record<string, any>> = Record<string, any>;
export type UseFormOptions<_TValues extends Record<string, any> = Record<string, any>> = Record<string, any>;
export type UseFormReturn<_TValues extends Record<string, any> = Record<string, any>> = Record<string, any>;

export function createForm(_config: Record<string, any>): Record<string, any> {
  throw new Error(
    "[palistor] createForm is deprecated. Use createProxyStore + useForm instead.\n" +
    "See react/useForm.test.tsx for usage examples.",
  );
}
