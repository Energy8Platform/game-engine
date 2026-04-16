const RESERVED = new Set(['children', 'key', 'ref']);
/** Props handled by the reconciler as flex item config, not forwarded to components */
const FLEX_ITEM_PROPS = new Set(['flexGrow', 'flexShrink', 'layoutWidth', 'layoutHeight', 'alignSelf', 'flexExclude', 'top', 'right', 'bottom', 'left']);
/** Base Container props applied directly to the instance (not via config) */
const CONTAINER_PROPS = new Set([
  'x', 'y', 'alpha', 'visible', 'rotation', 'angle', 'zIndex',
  'label', 'cursor', 'eventMode',
]);

// ─── UI Component helpers ────────────────────────────────

/**
 * Extract a config object from React props.
 * - Strips reserved keys (children, key, ref) and event props
 * - Unfolds dash-notation into nested objects: `colors-default` → `{ colors: { default: ... } }`
 */
export function extractConfig(props: Record<string, any>): Record<string, any> {
  const config: Record<string, any> = {};

  for (const key in props) {
    if (RESERVED.has(key) || FLEX_ITEM_PROPS.has(key) || CONTAINER_PROPS.has(key) || isEventProp(key)) continue;

    if (key.includes('-')) {
      const parts = key.split('-');
      const root = parts[0];
      const nested = parts.slice(1).join('-');
      if (!config[root] || typeof config[root] !== 'object') {
        config[root] = {};
      }
      config[root][nested] = props[key];
    } else {
      config[key] = props[key];
    }
  }

  return config;
}

/**
 * Diff two prop sets and return a config object with only changed values.
 * Uses extractConfig format (dash-notation unfolded).
 */
export function diffConfig(
  newProps: Record<string, any>,
  oldProps: Record<string, any>,
): Record<string, any> {
  const changed: Record<string, any> = {};

  // New or changed props
  for (const key in newProps) {
    if (RESERVED.has(key) || FLEX_ITEM_PROPS.has(key) || CONTAINER_PROPS.has(key) || isEventProp(key)) continue;
    if (newProps[key] !== oldProps[key]) {
      if (key.includes('-')) {
        const parts = key.split('-');
        const root = parts[0];
        const nested = parts.slice(1).join('-');
        if (!changed[root] || typeof changed[root] !== 'object') {
          changed[root] = {};
        }
        changed[root][nested] = newProps[key];
      } else {
        changed[key] = newProps[key];
      }
    }
  }

  return changed;
}

/**
 * Apply only event props from React props to a PixiJS instance.
 */
export function applyEventProps(
  instance: any,
  newProps: Record<string, any>,
  oldProps: Record<string, any> = {},
): void {
  // Remove old event handlers
  for (const key in oldProps) {
    if (!isEventProp(key) || key in newProps) continue;
    instance[REACT_TO_PIXI_EVENTS[key]] = null;
  }
  // Apply new/changed event handlers + onPress (component-level callback)
  for (const key in newProps) {
    if (key === 'onPress') {
      instance.onPress = newProps[key];
      continue;
    }
    if (!isEventProp(key)) continue;
    if (newProps[key] !== oldProps[key]) {
      instance[REACT_TO_PIXI_EVENTS[key]] = newProps[key];
    }
  }
}

const REACT_TO_PIXI_EVENTS: Record<string, string> = {
  onClick: 'onclick',
  onPointerDown: 'onpointerdown',
  onPointerUp: 'onpointerup',
  onPointerMove: 'onpointermove',
  onPointerOver: 'onpointerover',
  onPointerOut: 'onpointerout',
  onPointerEnter: 'onpointerenter',
  onPointerLeave: 'onpointerleave',
  onPointerCancel: 'onpointercancel',
  onPointerTap: 'onpointertap',
  onPointerUpOutside: 'onpointerupoutside',
  onMouseDown: 'onmousedown',
  onMouseUp: 'onmouseup',
  onMouseMove: 'onmousemove',
  onMouseOver: 'onmouseover',
  onMouseOut: 'onmouseout',
  onMouseEnter: 'onmouseenter',
  onMouseLeave: 'onmouseleave',
  onMouseUpOutside: 'onmouseupoutside',
  onTouchStart: 'ontouchstart',
  onTouchEnd: 'ontouchend',
  onTouchMove: 'ontouchmove',
  onTouchCancel: 'ontouchcancel',
  onTouchEndOutside: 'ontouchendoutside',
  onWheel: 'onwheel',
  onRightClick: 'onrightclick',
  onRightDown: 'onrightdown',
  onRightUp: 'onrightup',
  onRightUpOutside: 'onrightupoutside',
  onTap: 'ontap',
  onGlobalpointermove: 'onglobalpointermove',
  onGlobalmousemove: 'onglobalmousemove',
  onGlobaltouchmove: 'onglobaltouchmove',
};

export function isEventProp(key: string): boolean {
  return key in REACT_TO_PIXI_EVENTS;
}

export function hasEventProps(props: Record<string, any>): boolean {
  for (const key in props) {
    if (isEventProp(key)) return true;
  }
  return false;
}

function setNestedValue(target: any, path: string[], value: any): void {
  let obj = target;
  for (let i = 0; i < path.length - 1; i++) {
    obj = obj[path[i]];
    if (obj == null) return;
  }
  obj[path[path.length - 1]] = value;
}

/**
 * Apply base Container props (x, y, alpha, visible, etc.) directly to the instance.
 * Called for ALL elements — both UI components and standard PixiJS elements.
 * Also handles scale, pivot, position, anchor via dash-notation.
 */
export function applyContainerProps(
  instance: any,
  newProps: Record<string, any>,
  oldProps: Record<string, any> = {},
): void {
  for (const key of CONTAINER_PROPS) {
    if (key in newProps && newProps[key] !== oldProps[key]) {
      try { instance[key] = newProps[key]; } catch { /* read-only */ }
    } else if (key in oldProps && !(key in newProps)) {
      // Prop removed — reset to undefined (PixiJS defaults)
      try { instance[key] = undefined; } catch { /* read-only */ }
    }
  }
  // Handle scale as uniform number or {x,y} object
  if ('scale' in newProps && newProps.scale !== oldProps.scale) {
    const s = newProps.scale;
    if (typeof s === 'number') {
      instance.scale?.set?.(s, s);
    } else if (s && typeof s === 'object') {
      instance.scale?.set?.(s.x ?? 1, s.y ?? 1);
    }
  }
  // Handle dash-notation container props: scale-x, scale-y, pivot-x, pivot-y, position-x, position-y, anchor-x, anchor-y
  for (const key in newProps) {
    if (!key.includes('-')) continue;
    const parts = key.split('-');
    const root = parts[0];
    if (root === 'scale' || root === 'pivot' || root === 'position' || root === 'anchor') {
      if (newProps[key] !== oldProps[key]) {
        setNestedValue(instance, parts, newProps[key]);
      }
    }
  }
}

export function applyProps(
  instance: any,
  newProps: Record<string, any>,
  oldProps: Record<string, any> = {},
): void {
  // Remove old props not in newProps
  for (const key in oldProps) {
    if (RESERVED.has(key) || FLEX_ITEM_PROPS.has(key) || key in newProps) continue;

    const pixiEvent = REACT_TO_PIXI_EVENTS[key];
    if (pixiEvent) {
      instance[pixiEvent] = null;
    } else if (key === 'draw') {
      // no-op: can't un-draw
    } else if (key.includes('-')) {
      // Nested property reset not trivially possible, skip
    } else {
      try {
        instance[key] = undefined;
      } catch {
        // read-only or non-configurable
      }
    }
  }

  // Apply new props
  for (const key in newProps) {
    if (RESERVED.has(key) || FLEX_ITEM_PROPS.has(key)) continue;

    const value = newProps[key];
    const pixiEvent = REACT_TO_PIXI_EVENTS[key];

    if (pixiEvent) {
      instance[pixiEvent] = value;
    } else if (key === 'draw' && typeof value === 'function') {
      instance.clear?.();
      value(instance);
    } else if (key.includes('-')) {
      const parts = key.split('-');
      setNestedValue(instance, parts, value);
    } else {
      try {
        instance[key] = value;
      } catch {
        // read-only property
      }
    }
  }
}
