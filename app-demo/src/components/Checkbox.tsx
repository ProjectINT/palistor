import { Checkbox as HeroUICheckbox } from "@heroui/react";
import type { FieldProxyNode } from "@palistor";

interface CheckboxProps extends Omit<React.ComponentProps<typeof HeroUICheckbox>, keyof FieldProxyNode<boolean>> {
  children?: React.ReactNode;
  isSelected?: boolean;
}

export function Checkbox(props: FieldProxyNode<boolean> & Partial<CheckboxProps>) {
  const { isVisible, error, value, description, errorMessage, ...restProps } = props;

  if (!isVisible) {
    return null;
  }

  const hasError = Boolean(error);
  const helperText = hasError ? errorMessage : description;

  return (
    <div className="flex flex-col gap-1">
      <HeroUICheckbox
        {...restProps}
        isInvalid={hasError}
        classNames={{
          ...restProps.classNames,
          base: `${hasError ? 'data-[invalid=true]:border-danger' : ''} ${restProps.classNames?.base || ''}`,
        }}
      />
      {helperText && (
        <p
          className={`text-xs px-1 ${
            hasError ? 'text-danger' : 'text-default-500'
          }`}
        >
          {helperText}
        </p>
      )}
    </div>
  );
}
