import { CATEGORIES, categoryName, type Category } from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";

/** A row of chips that filters the model list by what a model is for. One is chosen, and All is none. */
export function CategoryChips({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: Category | null;
  onChange: (category: Category | null) => void;
  /** Off while the dialog is busy with an action. */
  disabled?: boolean;
  className?: string;
}) {
  const chips: { label: string; category: Category | null }[] = [
    { label: "All", category: null },
    ...CATEGORIES.map((category) => ({ label: categoryName(category), category })),
  ];
  return (
    <div role="group" aria-label="Filter by category" className={cn("flex flex-wrap gap-1.5", className)}>
      {chips.map((chip) => {
        const active = chip.category === value;
        return (
          <Button
            key={chip.label}
            size="sm"
            kind={active ? "primary" : "secondary"}
            aria-pressed={active}
            disabled={disabled}
            className="rounded-full"
            onClick={() => onChange(chip.category)}
          >
            {chip.label}
          </Button>
        );
      })}
    </div>
  );
}
