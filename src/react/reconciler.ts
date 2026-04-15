import Reconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants';
import { Container } from 'pixi.js';
import { catalogue } from './catalogue';
import { applyProps, hasEventProps, extractConfig, diffConfig, applyEventProps } from './applyProps';
import { FlexContainer } from '../ui/FlexContainer';
import type { FlexItemConfig } from '../ui/FlexContainer';

/** Flex item prop names that should be forwarded to _flexConfig on the child */
const FLEX_ITEM_PROPS = ['flexGrow', 'flexShrink', 'layoutWidth', 'layoutHeight', 'alignSelf', 'flexExclude', 'top', 'right', 'bottom', 'left'] as const;

/** Any component with suspendLayout/resumeLayout (FlexContainer, Panel, etc.) */
interface Suspendable {
  suspendLayout(): void;
  resumeLayout(): void;
}

function isSuspendable(obj: any): obj is Suspendable {
  return typeof obj?.suspendLayout === 'function' && typeof obj?.resumeLayout === 'function';
}

/** Layout containers that need flush after commit phase */
const pendingLayoutFlush = new Set<Suspendable>();

/** Extract FlexItemConfig from props if any flex item props are present */
function extractFlexItemConfig(props: Record<string, any>): FlexItemConfig | undefined {
  let config: FlexItemConfig | undefined;
  for (const key of FLEX_ITEM_PROPS) {
    if (key in props) {
      if (!config) config = {};
      (config as any)[key] = props[key];
    }
  }
  return config;
}

/** Apply flex item config to a child being added to a FlexContainer */
function addChildToFlex(parent: FlexContainer, child: Container & { _flexConfig?: FlexItemConfig }): void {
  const flexConfig = child._flexConfig;
  if (flexConfig && Object.keys(flexConfig).length > 0) {
    parent.addFlexChild(child, flexConfig);
  } else {
    parent.addChild(child);
  }
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const hostConfig: Reconciler.HostConfig<
  string,         // Type
  Record<string, any>, // Props
  Container,      // Container
  any,            // Instance
  any,            // TextInstance
  any,            // SuspenseInstance
  any,            // HydratableInstance
  any,            // PublicInstance
  any,            // HostContext
  any,            // UpdatePayload
  any,            // ChildSet
  any,            // TimeoutHandle
  any             // NoTimeout
> = {
  isPrimaryRenderer: false,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,

  createInstance(type, props) {
    const name = toPascalCase(type);
    const Ctor = catalogue[name];
    if (!Ctor) {
      throw new Error(
        `[PixiReconciler] Unknown element "<${type}>". ` +
        `Call extend({ ${name} }) before rendering.`,
      );
    }

    let instance;
    if (typeof Ctor.prototype.updateConfig === 'function') {
      // Config-based UI component: pass props as constructor config
      const config = extractConfig(props);
      instance = new Ctor(config);
      applyEventProps(instance, props);
    } else {
      // Standard PixiJS element
      instance = new Ctor();
      applyProps(instance, props);
    }

    if (hasEventProps(props) && instance.eventMode === 'auto') {
      instance.eventMode = 'static';
    }

    // Store flex item config for when this child is added to a FlexContainer parent
    const flexItemConfig = extractFlexItemConfig(props);
    if (flexItemConfig) {
      instance._flexConfig = { ...instance._flexConfig, ...flexItemConfig };
    }

    return instance;
  },

  createTextInstance() {
    throw new Error(
      '[PixiReconciler] Text strings are not supported. Use a <text> element.',
    );
  },

  appendInitialChild(parent, child) {
    if (child instanceof Container) {
      if (isSuspendable(parent)) parent.suspendLayout();
      if (parent instanceof FlexContainer) {
        addChildToFlex(parent, child);
      } else {
        parent.addChild(child);
      }
    }
  },

  appendChild(parent, child) {
    if (child instanceof Container) {
      if (isSuspendable(parent)) {
        parent.suspendLayout();
        pendingLayoutFlush.add(parent);
      }
      if (parent instanceof FlexContainer) {
        addChildToFlex(parent, child);
      } else {
        parent.addChild(child);
      }
    }
  },

  appendChildToContainer(container, child) {
    if (child instanceof Container) container.addChild(child);
  },

  removeChild(parent, child) {
    if (child instanceof Container) {
      if (isSuspendable(parent)) {
        parent.suspendLayout();
        pendingLayoutFlush.add(parent);
      }
      parent.removeChild(child);
      child.destroy({ children: true });
    }
  },

  removeChildFromContainer(container, child) {
    if (child instanceof Container) {
      container.removeChild(child);
      child.destroy({ children: true });
    }
  },

  insertBefore(parent, child, beforeChild) {
    if (child instanceof Container && beforeChild instanceof Container) {
      if (child.parent) child.parent.removeChild(child);
      if (isSuspendable(parent)) {
        parent.suspendLayout();
        pendingLayoutFlush.add(parent);
      }
      const index = parent.getChildIndex(beforeChild);
      parent.addChildAt(child, index);
    }
  },

  insertInContainerBefore(container, child, beforeChild) {
    if (child instanceof Container && beforeChild instanceof Container) {
      if (child.parent) child.parent.removeChild(child);
      const index = container.getChildIndex(beforeChild);
      container.addChildAt(child, index);
    }
  },

  commitUpdate(instance, _updatePayload, _type, oldProps, newProps) {
    if (typeof instance.updateConfig === 'function') {
      const changed = diffConfig(newProps, oldProps);
      if (Object.keys(changed).length > 0) {
        instance.updateConfig(changed);
      }
      applyEventProps(instance, newProps, oldProps);
    } else {
      applyProps(instance, newProps, oldProps);
    }

    // Update flex item config if parent is FlexContainer
    const newFlexConfig = extractFlexItemConfig(newProps);
    const oldFlexConfig = extractFlexItemConfig(oldProps);
    if (newFlexConfig || oldFlexConfig) {
      instance._flexConfig = { ...instance._flexConfig, ...newFlexConfig };
      // Trigger parent relayout
      if (instance.parent instanceof FlexContainer) {
        instance.parent.updateLayout();
      }
    }

    if (hasEventProps(newProps) && instance.eventMode === 'auto') {
      instance.eventMode = 'static';
    }
  },

  finalizeInitialChildren(instance) {
    // Resume layout after all initial children have been appended
    if (isSuspendable(instance)) {
      instance.resumeLayout();
    }
    return false;
  },

  prepareUpdate() {
    return true;
  },

  shouldSetTextContent() {
    return false;
  },

  getRootHostContext() {
    return null;
  },

  getChildHostContext(parentHostContext: any) {
    return parentHostContext;
  },

  getPublicInstance(instance: any) {
    return instance;
  },

  prepareForCommit() {
    return null;
  },

  resetAfterCommit() {
    // Flush deferred layout for all FlexContainers modified during this commit
    for (const fc of pendingLayoutFlush) {
      fc.resumeLayout();
    }
    pendingLayoutFlush.clear();
  },

  preparePortalMount() {},

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,

  getCurrentEventPriority() {
    return DefaultEventPriority;
  },

  hideInstance(instance) {
    instance.visible = false;
  },

  unhideInstance(instance) {
    instance.visible = true;
  },

  hideTextInstance() {},
  unhideTextInstance() {},

  clearContainer() {},

  detachDeletedInstance() {},

  prepareScopeUpdate() {},
  getInstanceFromNode() { return null; },
  getInstanceFromScope() { return null; },
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
};

export const reconciler = Reconciler(hostConfig);
