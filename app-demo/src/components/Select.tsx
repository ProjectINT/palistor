import { Select as HeroUISelect } from "@heroui/react";
import { ComputedFieldState } from "../../../core/types";
import type { CollectionChildren } from "@react-types/shared";
import { SelectItem as HeroUISelectItem } from "@heroui/react";

export interface SelectOption {
  value: string;
  label: string;
  isDisabled?: boolean;
}

interface SelectPropsBase {
  children?: CollectionChildren<object>;
  selectedKeys?: Iterable<React.Key>;
  onSelectionChange?: (keys: "all" | Set<React.Key>) => void;
}

interface SelectPropsWithOptions extends SelectPropsBase {
  options: SelectOption[];
  renderLabel?: (option: SelectOption) => React.ReactNode;
}

interface SelectPropsWithChildren extends SelectPropsBase {
  options?: never;
  renderLabel?: never;
}

type SelectProps = SelectPropsWithOptions | SelectPropsWithChildren;

export function Select(props: ComputedFieldState & Partial<SelectProps>) {
  const { isVisible, error, value, options, renderLabel, children, ...restProps } = props;

  if (!isVisible) {
    return null;
  }

  const content = options
    ? options.map((option) => (
        <HeroUISelectItem key={option.value} isDisabled={option.isDisabled}>
          {renderLabel ? renderLabel(option) : option.label}
        </HeroUISelectItem>
      ))
    : children;

  return <HeroUISelect {...(restProps as any)}>{content}</HeroUISelect>;
}
