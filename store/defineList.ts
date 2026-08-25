import type {
  TypedListNode,
  TemplateConfig,
  ListResolver,
  ListResolveConfig,
  FilterBlock,
} from "./store/types";

interface DefineListConfig<TEntity extends Record<string, any>> {
  template: TemplateConfig<TEntity>;
  /**
   * Declared filter block. The common case is a plain object, Relay-style
   * (`filter: { search: "", brand: null }` — literal defaults become filter
   * fields whose values reach the resolver via `ctx.filter.params`); a field
   * that declares `where` filters client-side and never issues a request.
   */
  filter?: FilterBlock<TEntity>;
  resolve?: {
    resolver: ListResolver<TEntity>;
    deps?: string[];
    onError?: (error: unknown, ctx: { notify: (msg: string) => void }) => void;
  };
}

export function defineList<TEntity extends Record<string, any>>(
  config: DefineListConfig<TEntity>,
): TypedListNode<TEntity> {
  const node: any[] = [config.template];
  if (config.resolve || config.filter) {
    const listConfig: Record<string, unknown> = {};
    if (config.resolve) listConfig.resolve = config.resolve as ListResolveConfig;
    if (config.filter) listConfig.filter = config.filter;
    node.push(listConfig);
  }
  return node as unknown as TypedListNode<TEntity>;
}
