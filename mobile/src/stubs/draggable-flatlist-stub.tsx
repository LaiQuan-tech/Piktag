// Stub for react-native-draggable-flatlist.
//
// The real package depends on react-native-reanimated, which we had to
// uninstall because its UIManager swizzling (REASwizzledUIManager) crashes
// on RN 0.81 + iOS 17. This stub adapts DraggableFlatList to render as a
// plain RN FlatList, losing the drag-to-reorder capability but keeping the
// rest of the list UI working so the app compiles and runs.

import React from 'react';
import { FlatList, FlatListProps, ListRenderItemInfo } from 'react-native';

const noop = () => {};

// Minimal shape of the render-item params the real DraggableFlatList passes.
// Only the fields actually used by Piktag's code are filled.
export type RenderItemParams<T> = {
  item: T;
  getIndex: () => number | undefined;
  drag: () => void;
  isActive: boolean;
};

type DraggableFlatListProps<T> = Omit<FlatListProps<T>, 'renderItem'> & {
  renderItem: (params: RenderItemParams<T>) => React.ReactElement | null;
  onDragEnd?: (params: { data: T[]; from: number; to: number }) => void;
  activationDistance?: number;
  autoscrollThreshold?: number;
  autoscrollSpeed?: number;
};

function DraggableFlatListStub<T>(props: DraggableFlatListProps<T>) {
  const { renderItem, onDragEnd: _onDragEnd, activationDistance: _ad, autoscrollThreshold: _at, autoscrollSpeed: _as, ...rest } = props;

  const adaptedRenderItem = ({ item, index }: ListRenderItemInfo<T>) =>
    renderItem({
      item,
      getIndex: () => index,
      drag: noop,
      isActive: false,
    });

  return <FlatList<T> {...rest} renderItem={adaptedRenderItem} />;
}

export default DraggableFlatListStub;

// Passthrough wrappers for optional decorators used alongside the list.
export const ScaleDecorator = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const ShadowDecorator = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const OpacityDecorator = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const NestableScrollContainer = ({ children }: { children: React.ReactNode }) => <>{children}</>;
export const NestableDraggableFlatList = DraggableFlatListStub;
