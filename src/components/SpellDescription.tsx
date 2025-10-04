import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

export type SpellDescriptionProps = HTMLAttributes<HTMLDivElement> & {
  description: string;
};

export const SpellDescription = forwardRef<HTMLDivElement, SpellDescriptionProps>(
  ({ description, className, ...rest }, ref) => {
    const lines = description.split(/\r?\n/);
    return (
      <div ref={ref} className={className} {...rest}>
        {lines.map((line, index) => (
          <span key={index} className="block">
            {line === "" ? "\u00a0" : line}
          </span>
        ))}
      </div>
    );
  },
);

SpellDescription.displayName = "SpellDescription";
