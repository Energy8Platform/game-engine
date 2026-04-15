import Reconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants';
import { Container } from 'pixi.js';
import { catalogue } from './catalogue';
import { applyProps, hasEventProps, extractConfig, diffConfig, applyEventProps } from './applyProps';

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
    if (Ctor.prototype.__uiComponent) {
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

    return instance;
  },

  createTextInstance() {
    throw new Error(
      '[PixiReconciler] Text strings are not supported. Use a <text> element.',
    );
  },

  appendInitialChild(parent, child) {
    if (child instanceof Container) parent.addChild(child);
  },

  appendChild(parent, child) {
    if (child instanceof Container) parent.addChild(child);
  },

  appendChildToContainer(container, child) {
    if (child instanceof Container) container.addChild(child);
  },

  removeChild(parent, child) {
    if (child instanceof Container) {
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
    if (instance.__uiComponent && typeof instance.updateConfig === 'function') {
      const changed = diffConfig(newProps, oldProps);
      if (Object.keys(changed).length > 0) {
        instance.updateConfig(changed);
      }
      applyEventProps(instance, newProps, oldProps);
    } else {
      applyProps(instance, newProps, oldProps);
    }

    if (hasEventProps(newProps) && instance.eventMode === 'auto') {
      instance.eventMode = 'static';
    }
  },

  finalizeInitialChildren() {
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

  resetAfterCommit() {},

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
