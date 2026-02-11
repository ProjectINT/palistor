import { Button as HeroUIButton } from "@heroui/react";
import { ComputedFieldState } from "../../../core/types";

type ButtonProps = React.ComponentProps<typeof HeroUIButton>;

export function Button(props: ButtonProps) {
  return <HeroUIButton {...props} />;
}
