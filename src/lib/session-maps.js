// What a module keeps for one `process()` call, keyed by an object of that call's session. The
// entries are dropped when the call ends: while a long-lived WeakMap holds one, a minor collection
// keeps its value, and a value that reaches its key keeps the whole call's state until a full one.
const MAPS = [];

export function sessionMap() {
  const map = new WeakMap();
  MAPS.push(map);
  return map;
}

export function releaseSession(...keys) {
  for (const map of MAPS) {
    for (const key of keys) {
      map.delete(key);
    }
  }
}
