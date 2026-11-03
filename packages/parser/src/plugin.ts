import type {
  HyperPlugin,
  PluginContext,
  RequestContext,
  SendRequest,
  UniversalResponse,
} from "@hyperttp/types";
import { ResponseConverter } from "./utils/ResponseConverter.js";
import type { ResponseConverterOptions, ResponseType } from "./types/response.js";
import { safeHeader } from "./utils/helpers.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    responseConverter?: ResponseConverterOptions | false;
  }
}

function fastKey(opts?: Partial<ResponseConverterOptions>): string {
  if (!opts) return "default";
  return [
    opts.charset ?? "",
    opts.htmlMode ?? "",
    opts.parseHTML === false ? "0" : "1",
    opts.maxBodySize ?? "",
    opts.parseErrors === true ? "1" : "0",
  ].join("|");
}

type HttpInput = { method?: string; stream?: boolean };
function httpInput(req?: SendRequest): HttpInput {
  return req?.input !== null && typeof req?.input === "object" ? (req.input as HttpInput) : {};
}
function requestMetadata(req?: SendRequest, ctx?: RequestContext): Record<string, any> {
  return { ...ctx?.meta, ...req?.metadata };
}

function isRestResponse(res: UniversalResponse, req?: SendRequest): boolean {
  return res.protocol === "rest" || req?.protocol === "rest";
}

function defaultShouldParse(res: UniversalResponse, req?: SendRequest): boolean {
  return !(isRestResponse(res, req) && httpInput(req).method?.toUpperCase() === "HEAD");
}

function defaultIsEmptyResponse(res: UniversalResponse, req?: SendRequest): boolean {
  return (
    isRestResponse(res, req) && (res.status === 204 || res.status === 205 || res.status === 304)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isAlreadyConverted(
  source: unknown,
  targetType: ResponseType,
  options: ResponseConverterOptions,
): boolean {
  if (targetType === "auto" || targetType === "json") {
    return (
      Array.isArray(source) ||
      isPlainObject(source) ||
      typeof source === "number" ||
      typeof source === "boolean"
    );
  }
  if (targetType === "text") return typeof source === "string";
  if (targetType === "html") return options.parseHTML === false && typeof source === "string";
  if (targetType === "buffer") {
    return typeof Buffer !== "undefined" && Buffer.isBuffer(source);
  }
  return false;
}

export function withParser(pluginOptions: Partial<ResponseConverterOptions> = {}): HyperPlugin {
  let globalOptions!: ResponseConverterOptions;
  let defaultConverter!: ResponseConverter;
  const converterCache = new Map<string, ResponseConverter>();

  return {
    name: "hyperttp-parser",
    phase: "FORMAT",
    setup(ctx: PluginContext): void {
      globalOptions = {
        parseHTML: true,
        htmlMode: "full",
        parseErrors: false,
        ...ctx.config.responseConverter,
        ...pluginOptions,
      };
      defaultConverter = new ResponseConverter(globalOptions);
    },
    async onResponse(res: UniversalResponse, req, _ctx, reqCtx): Promise<UniversalResponse | void> {
      if (httpInput(req).stream) return;

      const meta = requestMetadata(req, reqCtx);
      const localOptions = meta.responseConverter as Partial<ResponseConverterOptions> | undefined;
      const effectiveOptions = localOptions ? { ...globalOptions, ...localOptions } : globalOptions;

      const shouldParse = effectiveOptions.shouldParse ?? defaultShouldParse;
      if (!(await shouldParse(res, req, reqCtx))) return;

      const isEmpty = effectiveOptions.isEmptyResponse ?? defaultIsEmptyResponse;
      if (await isEmpty(res, req, reqCtx)) return { ...res, data: null };

      const getData = effectiveOptions.getData ?? effectiveOptions.bodyExtractor;
      const source = getData ? await getData(res, req, reqCtx) : res.data;
      if (source == null) return;

      const getResponseType =
        effectiveOptions.getResponseType ?? effectiveOptions.detectResponseType;
      const targetType = getResponseType
        ? await getResponseType(res, req, reqCtx)
        : ((meta.responseType as ResponseType | undefined) ?? "auto");
      if (targetType === "stream") return;

      if (isAlreadyConverted(source, targetType, effectiveOptions)) {
        return source === res.data ? undefined : { ...res, data: source };
      }

      let converter = defaultConverter;
      if (localOptions?.xmlBuilderOptions || localOptions?.xmlParserOptions) {
        converter = new ResponseConverter(effectiveOptions);
      } else if (localOptions) {
        const cacheKey = fastKey(localOptions);
        let cached = converterCache.get(cacheKey);
        if (!cached) {
          cached = new ResponseConverter(effectiveOptions);
          converterCache.set(cacheKey, cached);
        }
        converter = cached;
      }

      const conversionMeta =
        targetType === "auto"
          ? { contentType: safeHeader(res.headers, "content-type"), url: res.url }
          : undefined;
      const data = (await converter.convert(source, targetType, conversionMeta)) ?? null;
      return { ...res, data };
    },
  };
}
