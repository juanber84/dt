import { reactive } from 'vue';

// Registros a mano por fecha. En memoria hasta que exista POST /api/v1/entries.
const entries = reactive({});

export function clearManualEntries() {
  for (const date of Object.keys(entries)) delete entries[date];
}

export function useManualEntries() {
  const forDate = (date) => entries[date] ?? [];
  const add = (date, entry) => {
    entries[date] = [...forDate(date), entry];
  };
  return { forDate, add };
}
