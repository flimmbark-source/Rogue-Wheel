import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

export type SpellDescriptionProps = HTMLAttributes<HTMLDivElement> & {
  description: string;
};

export const SpellDescription = forwardRef<HTMLDivElement, SpellDescriptionProps>(
  ({ description, className, ...rest }, ref) => {
    const combinedClassName = ["whitespace-pre-line", className]
      .filter(Boolean)
      .join(" ");

    return (
      <div ref={ref} className={combinedClassName} {...rest}>
        {description === "" ? "\u00a0" : description}
      </div>
    );
  },
);

SpellDescription.displayName = "SpellDescription";
