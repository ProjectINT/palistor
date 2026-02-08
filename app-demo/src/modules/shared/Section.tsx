interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
