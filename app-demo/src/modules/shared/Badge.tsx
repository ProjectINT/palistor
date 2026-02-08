type BadgeColor = "zinc" | "blue" | "green" | "red" | "amber";

interface BadgeProps {
  children: React.ReactNode;
  color?: BadgeColor;
}

const colorStyles: Record<BadgeColor, string> = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
};

export function Badge({ children, color = "zinc" }: BadgeProps) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorStyles[color]}`}>
      {children}
    </span>
  );
}
