import type { z } from "zod";

import {
  InvalidJsonResponseError,
  MissingPathParameterError,
  MissingResponseBodyError,
  type OperationInputLocation,
  OperationInputValidationError,
  OperationResponseValidationError,
  UndeclaredResponseStatusError,
} from "./errors.js";
import type {
  AvailableOperationMethod,
  HttpMethod,
  OperationContext,
  OperationDefinition,
  OperationInput,
  OperationPath,
  OperationResult,
  ResponseRejectionHandlers,
  ResponseSchemas,
} from "./types.js";

const bodylessStatuses = new Set([204, 205, 304]);

function parseInput(
  schema: z.ZodType,
  value: unknown,
  method: string,
  path: string,
  location: OperationInputLocation,
): unknown {
  try {
    return schema.parse(value);
  } catch (cause) {
    throw new OperationInputValidationError(method, path, location, cause);
  }
}

function renderPath(
  template: string,
  parameters: unknown,
  method: string,
): string {
  const values = (parameters ?? {}) as Record<string, unknown>;

  return template.replaceAll(/{([^}]+)}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) {
      throw new MissingPathParameterError(method, template, name);
    }

    return encodeURIComponent(String(value));
  });
}

function appendQueryValue(
  searchParams: URLSearchParams,
  name: string,
  value: unknown,
): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(searchParams, name, item);
    }
    return;
  }

  if (!["string", "number", "boolean", "bigint"].includes(typeof value)) {
    throw new TypeError(`Unsupported query value for ${name}`);
  }

  searchParams.append(name, String(value));
}

function appendQuery(url: URL, query: unknown): void {
  if (query === undefined || query === null) {
    return;
  }

  if (typeof query !== "object" || Array.isArray(query)) {
    throw new TypeError("Query parameters must be an object");
  }

  for (const [name, value] of Object.entries(query)) {
    appendQueryValue(url.searchParams, name, value);
  }
}

function createOperationUrl(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl.replace(/\/+$/, "")}${path}`);
}

async function readResponseBody(
  response: Response,
  method: string,
  path: string,
): Promise<unknown> {
  if (method === "HEAD" || bodylessStatuses.has(response.status)) {
    return undefined;
  }

  const text = await response.text();
  if (text.length === 0) {
    throw new MissingResponseBodyError(method, path, response.status);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new InvalidJsonResponseError(method, path, response.status, cause);
  }
}

function parseResponse(
  schema: z.ZodType,
  value: unknown,
  method: string,
  path: string,
  status: number,
): unknown {
  try {
    return schema.parse(value);
  } catch (cause) {
    throw new OperationResponseValidationError(method, path, status, cause);
  }
}

async function applyRequestMiddleware(
  request: Request,
  middleware: OperationContext["requestMiddleware"],
): Promise<Request> {
  let currentRequest = request;

  for (const transform of middleware ?? []) {
    currentRequest = await transform(currentRequest);
  }

  return currentRequest;
}

async function applyResponseMiddleware(
  response: Response,
  request: Request,
  middleware: OperationContext["responseMiddleware"],
): Promise<Response> {
  let currentResponse = response;

  for (const transform of middleware ?? []) {
    currentResponse = await transform(currentResponse, request);
  }

  return currentResponse;
}

type JsonOperationFactory<
  TPaths extends object,
  TRejectedStatus extends number,
> = {
  <
    const TPath extends OperationPath<TPaths>,
    const TMethod extends AvailableOperationMethod<TPaths, TPath>,
    const TPathSchema extends z.ZodType = z.ZodType,
    const TQuerySchema extends z.ZodType = z.ZodType,
    const TBodySchema extends z.ZodType = z.ZodType,
    const TResponseSchemas extends ResponseSchemas<
      TPaths,
      TPath,
      TMethod
    > = ResponseSchemas<TPaths, TPath, TMethod>,
  >(
    definition: OperationDefinition<
      TPaths,
      TPath,
      TMethod,
      TPathSchema,
      TQuerySchema,
      TBodySchema,
      TResponseSchemas
    >,
  ): (
    context: OperationContext,
    input: OperationInput<
      TPaths,
      TPath,
      TMethod,
      TPathSchema,
      TQuerySchema,
      TBodySchema
    >,
  ) => Promise<OperationResult<TResponseSchemas, TRejectedStatus>>;

  withResponseRejectionHandlers<
    const THandlers extends ResponseRejectionHandlers<number>,
  >(
    handlers: THandlers,
  ): JsonOperationFactory<
    TPaths,
    TRejectedStatus | Extract<keyof THandlers, number>
  >;
};

function buildJsonOperationFactory<
  TPaths extends object,
  TRejectedStatus extends number,
>(
  rejectionHandlers: Readonly<
    Partial<ResponseRejectionHandlers<TRejectedStatus>>
  >,
): JsonOperationFactory<TPaths, TRejectedStatus> {
  function defineJsonOperation<
    const TPath extends OperationPath<TPaths>,
    const TMethod extends AvailableOperationMethod<TPaths, TPath>,
    const TPathSchema extends z.ZodType = z.ZodType,
    const TQuerySchema extends z.ZodType = z.ZodType,
    const TBodySchema extends z.ZodType = z.ZodType,
    const TResponseSchemas extends ResponseSchemas<
      TPaths,
      TPath,
      TMethod
    > = ResponseSchemas<TPaths, TPath, TMethod>,
  >(
    definition: OperationDefinition<
      TPaths,
      TPath,
      TMethod,
      TPathSchema,
      TQuerySchema,
      TBodySchema,
      TResponseSchemas
    >,
  ) {
    const method = definition.method.toUpperCase();
    const responseSchemas = definition.responses as Record<number, z.ZodType>;

    return async (
      context: OperationContext,
      input: OperationInput<
        TPaths,
        TPath,
        TMethod,
        TPathSchema,
        TQuerySchema,
        TBodySchema
      >,
    ): Promise<OperationResult<TResponseSchemas, TRejectedStatus>> => {
      const pathParameters = definition.pathSchema
        ? parseInput(
            definition.pathSchema,
            input.path,
            method,
            definition.path,
            "path",
          )
        : undefined;
      const query = definition.querySchema
        ? parseInput(
            definition.querySchema,
            input.query,
            method,
            definition.path,
            "query",
          )
        : undefined;
      const body = definition.bodySchema
        ? parseInput(
            definition.bodySchema,
            input.body,
            method,
            definition.path,
            "body",
          )
        : undefined;
      const renderedPath = renderPath(definition.path, pathParameters, method);
      const url = createOperationUrl(context.baseUrl, renderedPath);
      appendQuery(url, query);

      const headers = new Headers(context.headers);
      if (!headers.has("accept")) {
        headers.set("accept", "application/json");
      }
      if (body !== undefined && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }

      const requestInit: RequestInit = { method, headers };
      if (body !== undefined) {
        requestInit.body = JSON.stringify(body);
      }

      const request = await applyRequestMiddleware(
        new Request(url, requestInit),
        context.requestMiddleware,
      );
      const fetchImplementation = context.fetch ?? globalThis.fetch;
      const response = await applyResponseMiddleware(
        await fetchImplementation(request),
        request,
        context.responseMiddleware,
      );
      const responseSchema = responseSchemas[response.status];

      if (!responseSchema) {
        throw new UndeclaredResponseStatusError(
          method,
          definition.path,
          response.status,
        );
      }

      const data = parseResponse(
        responseSchema,
        await readResponseBody(response, method, definition.path),
        method,
        definition.path,
        response.status,
      );
      const rejectionHandler =
        rejectionHandlers[response.status as TRejectedStatus];

      if (rejectionHandler) {
        throw await rejectionHandler({
          data,
          method,
          path: definition.path,
          status: response.status as TRejectedStatus,
        });
      }

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          data,
        } as OperationResult<TResponseSchemas, TRejectedStatus>;
      }

      return {
        ok: false,
        status: response.status,
        error: {
          status: response.status,
          data,
        },
      } as OperationResult<TResponseSchemas, TRejectedStatus>;
    };
  }

  const factory = defineJsonOperation as unknown as JsonOperationFactory<
    TPaths,
    TRejectedStatus
  >;

  return Object.assign(factory, {
    withResponseRejectionHandlers<
      const THandlers extends ResponseRejectionHandlers<number>,
    >(handlers: THandlers) {
      return buildJsonOperationFactory<
        TPaths,
        TRejectedStatus | Extract<keyof THandlers, number>
      >({ ...rejectionHandlers, ...handlers });
    },
  });
}

/**
 * Binds the operation definition function to one openapi-typescript `paths`
 * type. The returned function both checks the definition statically and builds
 * the executable operation.
 */
export function createJsonOperationFactory<TPaths extends object>() {
  return buildJsonOperationFactory<TPaths, never>({});
}

/** Methods supported by the generated OpenAPI path shape. */
export const supportedHttpMethods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const satisfies readonly HttpMethod[];
