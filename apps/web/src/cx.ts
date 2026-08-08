// Tiny classname combinator — CSS Modules gives locally-scoped class names
// but no help composing them conditionally, and the app's needs (a variant
// class here, a boolean modifier there) don't justify a dependency for it.
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
