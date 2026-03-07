import { Checkbox as HeroUICheckbox } from "@heroui/react";
import type { FieldProxyNode } from "@palistor";

interface CheckboxProps extends Omit<React.ComponentProps<typeof HeroUICheckbox>, keyof FieldProxyNode<boolean>> {
  children?: React.ReactNode;
  isSelected?: boolean;
}

export function Checkbox(props: FieldProxyNode<boolean> & Partial<CheckboxProps>) {
  const { isVisible, value, description, errorMessage, ...restProps } = props;

  if (!isVisible) {
    return null;
  }

  const helperText = errorMessage ? errorMessage : description;

  return (
    <div className="flex flex-col gap-1">
      <HeroUICheckbox
        {...restProps}
        classNames={{
          ...restProps.classNames,
          base: `${errorMessage ? 'data-[invalid=true]:border-danger' : ''} ${restProps.classNames?.base || ''}`,
        }}
      />
      {helperText && (
        <p
          className={`text-xs px-1 ${
            errorMessage ? 'text-danger' : 'text-default-500'
          }`}
        >
          {helperText}
        </p>
      )}
    </div>
  );
}
