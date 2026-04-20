import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

interface BreadcrumbProps {
  items: Array<{ label: string; href?: string }>;
}

export default function Breadcrumb({ items }: BreadcrumbProps): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="flex items-center">
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="transition-colors hover:text-[#aa00ff]"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={
                      isLast
                        ? "font-medium text-slate-900"
                        : "text-slate-500"
                    }
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!isLast ? (
                <li aria-hidden="true" className="flex items-center">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
