// Shim for next/link — maps to react-router-dom Link
import React from "react";
import { Link as RouterLink } from "react-router-dom";

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  children: React.ReactNode;
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, prefetch, replace, scroll, children, ...props }, ref) => {
    // External links
    if (href.startsWith("http") || href.startsWith("//")) {
      return (
        <a href={href} ref={ref} {...props}>
          {children}
        </a>
      );
    }
    return (
      <RouterLink to={href} replace={replace} ref={ref} {...props}>
        {children}
      </RouterLink>
    );
  }
);

Link.displayName = "Link";

export default Link;
