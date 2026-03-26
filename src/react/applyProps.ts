const RESERVED = new Set(['children', 'key', 'ref']);

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

export function applyProps(
  instance: any,
  newProps: Record<string, any>,
  oldProps: Record<string, any> = {},
): void {
  // Remove old props not in newProps
  for (const key in oldProps) {
    if (RESERVED.has(key) || key in newProps) continue;

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
    if (RESERVED.has(key)) continue;

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
