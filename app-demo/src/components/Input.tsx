import { Input as HeroUIInput } from "@heroui/react";
import { ComputedFieldState } from "../../../core/types";

interface InputProps extends Omit<React.ComponentProps<typeof HeroUIInput>, keyof ComputedFieldState> {
  type?: string;
}

export function Input(props: ComputedFieldState & Partial<InputProps>) {
  const { isVisible, ...restProps } = props;

  if (!isVisible) {
    return null;
  }

  return <HeroUIInput {...restProps} />;
}