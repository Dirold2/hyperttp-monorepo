/**
 * @ru Рекурсивно объединяет два объекта. Избегает лишних аллокаций памяти и защищает от разделения ссылок nested-структур.
 * @en Recursively merges two objects. Avoids redundant memory allocations and prevents shared reference leakage for nested structures.
 */
export function deepMerge<T extends Record<string, unknown>, S extends Record<string, unknown>>(
  target: T,
  source: S,
): T & S {
  const output: Record<string, unknown> = { ...target };

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }

    const sourceValue = source[key];
    const targetValue = output[key];

    if (isObject(sourceValue) && isObject(targetValue)) {
      output[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
      continue;
    }

    if (sourceValue !== undefined) {
      output[key] = isObject(sourceValue)
        ? deepMerge({}, sourceValue as Record<string, unknown>)
        : sourceValue;
    }
  }

  return output as T & S;
}

/**
 * @ru Быстрая проверка, является ли переданный элемент чистым объектом (исключая массивы и null).
 * @en Fast check verifying if the provided item is a plain object layout (excluding arrays and null).
 */
function isObject(item: unknown): item is Record<string, unknown> {
  return (
    typeof item === "object" &&
    item !== null &&
    (item.constructor === Object || item.constructor === undefined)
  );
}
