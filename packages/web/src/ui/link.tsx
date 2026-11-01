import type { ComponentProps, MouseEvent } from "react";

export type LinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  /** Called instead of loading the page, for a plain left click. */
  onNavigate: (href: string) => void;
};

/** A real anchor, so it can open in a new tab, whose plain click goes to the router. */
export function Link({ href, onNavigate, onClick, ...props }: LinkProps) {
  function click(event: MouseEvent<HTMLAnchorElement>): void {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate(href);
  }
  return <a href={href} onClick={click} {...props} />;
}
