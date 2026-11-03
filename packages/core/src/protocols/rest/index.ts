import type { HyperProtocol } from "@hyperttp/types";
import type { RestInput, RestServerInput, RestServerResponse } from "./type.js";
import { RestReceiver } from "./receiver.js";
import { RestSender } from "./sender.js";

/**
 * @ru Единый REST-модуль протокола, объединяющий клиентский сендер и серверный ресивер.
 * @en Unified REST protocol module combining a client sender and a server receiver.
 */
export const RestProtocol: HyperProtocol<
  RestInput,
  unknown,
  RestServerInput,
  RestServerResponse,
  "rest"
> = {
  protocol: "rest",
  name: "RestProtocol",
  sender: new RestSender(),
  receiver: new RestReceiver(),
};

export { RestReceiver } from "./receiver.js";
export { RestSender } from "./sender.js";
