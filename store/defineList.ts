import type { TypedListNode, TemplateConfig, ListResolver, ListResolveConfig } from "./store/types";

interface DefineListConfig<TEntity extends Record<string, any>> {
  template: TemplateConfig<TEntity>;
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
  if (config.resolve) node.push({ resolve: config.resolve as ListResolveConfig });
  return node as unknown as TypedListNode<TEntity>;
}
