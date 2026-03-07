import { Input as HeroUIInput } from "@heroui/react";
import type { FieldProxyNode } from "@palistor";

interface InputProps extends Omit<React.ComponentProps<typeof HeroUIInput>, keyof FieldProxyNode<string>> {
  type?: string;
}

export function Input(props: FieldProxyNode<string> & Partial<InputProps>) {
  const { isVisible, ...restProps } = props;

  if (!isVisible) {
    return null;
  }

  return <HeroUIInput {...restProps} isInvalid={!!restProps.isInvalid} />;
}