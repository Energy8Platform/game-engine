import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onPick(): void;
  /** For a test to find the item by; rendered as `data-testid` when given. */
  testId?: string;
}

/** A context menu at a fixed point. Closes on Escape, on a mousedown outside itself, and after any item. */
export function ExplorerMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="e8-menu" style={{ position: 'fixed', left: x, top: y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="e8-menu-item"
          data-testid={item.testId}
          onClick={() => {
            onClose();
            item.onPick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
