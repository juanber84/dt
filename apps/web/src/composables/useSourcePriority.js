import { reactive, watch } from 'vue';
import { DATA_TYPES, SOURCES } from '../data/sources.js';

const KEY = 'digitaltwin:source-priority';

// Por defecto: el orden de SOURCES entre las fuentes que dan cada tipo
const defaults = Object.fromEntries(
  Object.keys(DATA_TYPES).map((type) => [
    type,
    Object.entries(SOURCES)
      .filter(([, source]) => source.provides.includes(type))
      .map(([id]) => id),
  ]),
);

const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
const priority = reactive({ ...defaults, ...stored });
watch(priority, (value) => localStorage.setItem(KEY, JSON.stringify(value)), { deep: true });

/**
 * Qué fuente manda cuando varias registran lo mismo (las demás se guardan igual). En
 * localStorage hasta que la API lo guarde.
 */
export function useSourcePriority() {
  const move = (type, index, delta) => {
    const list = [...priority[type]];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    priority[type] = list;
  };
  const reset = () => Object.assign(priority, defaults);
  return { priority, move, reset };
}
