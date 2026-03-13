import React, { Suspense } from "react";

interface DynamicOptions {
  loading?: React.ComponentType;
  ssr?: boolean;
}

export default function dynamic<T extends React.ComponentType<any>>(
  loader: () => Promise<T | { default: T }>,
  options?: DynamicOptions
): React.ComponentType<React.ComponentProps<T>> {
  const LazyComponent = React.lazy(async () => {
    const mod = await loader();
    if ("default" in mod) {
      return mod as { default: T };
    }
    return { default: mod as T };
  });

  const LoadingFallback = options?.loading;

  return function DynamicComponent(props: React.ComponentProps<T>) {
    return (
      <Suspense fallback={LoadingFallback ? <LoadingFallback /> : null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}
