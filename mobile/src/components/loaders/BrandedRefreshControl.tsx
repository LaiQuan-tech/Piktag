import React from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { COLORS } from '../../constants/theme';

/**
 * Brand-tinted RefreshControl. v1 is intentionally a thin wrapper that
 * sets the spinner colour on both platforms so we get a consistent
 * pull-to-refresh feel without inventing a new gesture surface.
 *
 * iOS:    `tintColor` colours the system spinner.
 * Android: `colors` is an array of palette colours the system rotates
 *          through; we ship just the brand purple to keep it on-brand.
 *
 * TODO(v2): swap the system spinner for a `<LogoLoader>` overlay so the
 * pull gesture reveals the brand mark mid-pull. That requires a custom
 * scroll-driven implementation (likely Reanimated's
 * `useAnimatedScrollHandler` over a sentinel header) and is deferred
 * until the screen-migration agents have finished moving everything to
 * this component — easier to flip the implementation once with a
 * matching prop API than to shim retrofits.
 */

export type BrandedRefreshControlProps = RefreshControlProps;

export default function BrandedRefreshControl(
  props: BrandedRefreshControlProps,
) {
  return (
    <RefreshControl
      tintColor={COLORS.piktag500}
      colors={[COLORS.piktag500]}
      {...props}
    />
  );
}
