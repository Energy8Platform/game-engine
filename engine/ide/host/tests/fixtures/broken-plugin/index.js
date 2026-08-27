export const name = 'broken';

export function apply() {
  throw new Error('this plugin is broken on purpose');
}
