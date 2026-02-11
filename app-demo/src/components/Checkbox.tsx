import { Checkbox as HeroUICheckbox } from "@heroui/react";
import { ComputedFieldState } from "../../../core/types";

interface CheckboxProps extends Omit<React.ComponentProps<typeof HeroUICheckbox>, keyof ComputedFieldState> {
  children?: React.ReactNode;
  isSelected?: boolean;
}

export function Checkbox(props: ComputedFieldState & Partial<CheckboxProps>) {
  const { isVisible, error, value, ...restProps } = props;

  if (!isVisible) {
    return null;
  }

  return <HeroUICheckbox {...restProps} />;
}
