import type { IHyperCore } from "./index.js";

/**
 * @ru Интерфейс адаптера, который транслирует API ядра Hyperttp в формат, совместимый со сторонней
 * библиотекой (например, axios, ky, got). Позволяет использовать Hyperttp как drop-in замену без
 * изменения пользовательского кода.
 * @en Adapter interface that translates the Hyperttp core API into a third-party library compatible
 * format (e.g., axios, ky, got). Allows using Hyperttp as a drop-in replacement without modifying
 * user code.
 * @template T - The type of the adapted client instance returned by the adapter.
 */
export interface HyperAdapter<T> {
  /**
   * @ru Уникальное имя адаптера (например, 'axios', 'ky').
   * @en Unique adapter name (e.g., 'axios', 'ky').
   */
  readonly name: string;

  /**
   * @ru Опциональная версия адаптера для отслеживания совместимости.
   * @en Optional adapter version for compatibility tracking.
   */
  readonly version?: string;

  /**
   * @ru Создаёт адаптированный клиент на основе ядра Hyperttp.
   * @en Creates an adapted client based on the Hyperttp core.
   * @param core - The Hyperttp core instance to adapt.
   * @returns The adapted client instance of type T.
   */
  adapt(core: IHyperCore): T;
}
