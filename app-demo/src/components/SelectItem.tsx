import { SelectItem as HeroUISelectItem } from "@heroui/react";

type SelectItemProps = React.ComponentProps<typeof HeroUISelectItem>;

export function SelectItem(props: SelectItemProps) {
  return <HeroUISelectItem {...props} />;
}
