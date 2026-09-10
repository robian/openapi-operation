import type { z } from "zod";

/** HTTP methods represented by openapi-typescript path types. */
export type HttpMethod =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace";

export type OperationPath<TPaths extends object> = Extract<
  keyof TPaths,
  string
>;

type OperationMethod<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
> = Extract<HttpMethod, keyof TPaths[TPath]>;

export type AvailableOperationMethod<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
> = {
  [TMethod in OperationMethod<TPaths, TPath>]: Exclude<
    TPaths[TPath][TMethod],
    undefined
  > extends never
    ? never
    : TMethod;
}[OperationMethod<TPaths, TPath>];

type Operation<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
> = TMethod extends keyof TPaths[TPath]
  ? Exclude<TPaths[TPath][TMethod], undefined>
  : never;

type OperationParameter<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
  TLocation extends "path" | "query",
> =
  Operation<TPaths, TPath, TMethod> extends {
    parameters?: infer TParameters;
  }
    ? TLocation extends keyof NonNullable<TParameters>
      ? NonNullable<NonNullable<TParameters>[TLocation]>
      : never
    : never;

type OperationBody<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
> =
  Operation<TPaths, TPath, TMethod> extends {
    requestBody?: infer TRequestBody;
  }
    ? NonNullable<TRequestBody> extends { content: infer TContent }
      ? [TContent] extends [never]
        ? never
        : TContent extends { "application/json": infer TBody }
          ? TBody
          : never
      : never
    : never;

type OperationResponses<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
> =
  Operation<TPaths, TPath, TMethod> extends { responses: infer TResponses }
    ? TResponses
    : never;

export type DocumentedStatus<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
> = Extract<keyof OperationResponses<TPaths, TPath, TMethod>, number>;

type OperationResponseBody<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
  TStatus extends DocumentedStatus<TPaths, TPath, TMethod>,
> = OperationResponses<TPaths, TPath, TMethod>[TStatus] extends {
  content: infer TContent;
}
  ? [TContent] extends [never]
    ? undefined
    : TContent extends { "application/json": infer TBody }
      ? TBody
      : undefined
  : undefined;

type ZodVoidOutput = z.output<z.ZodVoid>;

/**
 * Reconciles equivalent edge cases emitted differently by OpenAPI generators.
 * It intentionally does not weaken ordinary object, array, or primitive types.
 */
type OptionalKeys<T extends object> = {
  [TKey in keyof T]-?: object extends Pick<T, TKey> ? TKey : never;
}[keyof T];

type NormalizeObject<T extends object> = {
  [TKey in Exclude<keyof T, OptionalKeys<T>>]: NormalizeGeneratorOutput<
    T[TKey]
  >;
} & {
  [TKey in OptionalKeys<T>]?: NormalizeGeneratorOutput<
    Exclude<T[TKey], undefined>
  >;
};

type NormalizeGeneratorOutput<T> = [T] extends [ZodVoidOutput]
  ? [ZodVoidOutput] extends [T]
    ? undefined
    : T
  : T extends Record<string, never>
    ? Record<string, unknown>
    : T extends readonly (infer TItem)[]
      ? NormalizeGeneratorOutput<TItem>[]
      : T extends object
        ? NormalizeObject<T>
        : T;

type CompatibleSchema<TSchema extends z.ZodType, TContract> =
  NormalizeGeneratorOutput<
    z.output<TSchema>
  > extends NormalizeGeneratorOutput<TContract>
    ? NormalizeGeneratorOutput<TContract> extends NormalizeGeneratorOutput<
        z.input<TSchema>
      >
      ? TSchema
      : never
    : never;

export type ResponseSchemas<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
> = {
  [TStatus in DocumentedStatus<TPaths, TPath, TMethod>]: z.ZodType;
};

type ValidatedResponseSchemas<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
  TSchemas extends ResponseSchemas<TPaths, TPath, TMethod>,
> = {
  [TStatus in DocumentedStatus<TPaths, TPath, TMethod>]: CompatibleSchema<
    TSchemas[TStatus],
    OperationResponseBody<TPaths, TPath, TMethod, TStatus>
  >;
};

type RequestSchemaDefinition<
  TName extends "pathSchema" | "querySchema" | "bodySchema",
  TSchema extends z.ZodType,
  TContract,
> = [TContract] extends [never]
  ? { [TKey in TName]?: never }
  : { [TKey in TName]: CompatibleSchema<TSchema, TContract> };

export type OperationDefinition<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
  TPathSchema extends z.ZodType,
  TQuerySchema extends z.ZodType,
  TBodySchema extends z.ZodType,
  TResponseSchemas extends ResponseSchemas<TPaths, TPath, TMethod>,
> = {
  path: TPath;
  method: TMethod;
  responses: TResponseSchemas &
    ValidatedResponseSchemas<TPaths, TPath, TMethod, TResponseSchemas> &
    Record<
      Exclude<keyof TResponseSchemas, DocumentedStatus<TPaths, TPath, TMethod>>,
      never
    >;
} & RequestSchemaDefinition<
  "pathSchema",
  TPathSchema,
  OperationParameter<TPaths, TPath, TMethod, "path">
> &
  RequestSchemaDefinition<
    "querySchema",
    TQuerySchema,
    OperationParameter<TPaths, TPath, TMethod, "query">
  > &
  RequestSchemaDefinition<
    "bodySchema",
    TBodySchema,
    OperationBody<TPaths, TPath, TMethod>
  >;

type RequestInput<
  TName extends "path" | "query" | "body",
  TSchema extends z.ZodType,
  TContract,
> = [TContract] extends [never]
  ? { [TKey in TName]?: never }
  : undefined extends z.input<TSchema>
    ? { [TKey in TName]?: z.input<TSchema> }
    : { [TKey in TName]: z.input<TSchema> };

export type OperationInput<
  TPaths extends object,
  TPath extends OperationPath<TPaths>,
  TMethod extends HttpMethod,
  TPathSchema extends z.ZodType,
  TQuerySchema extends z.ZodType,
  TBodySchema extends z.ZodType,
> = RequestInput<
  "path",
  TPathSchema,
  OperationParameter<TPaths, TPath, TMethod, "path">
> &
  RequestInput<
    "query",
    TQuerySchema,
    OperationParameter<TPaths, TPath, TMethod, "query">
  > &
  RequestInput<"body", TBodySchema, OperationBody<TPaths, TPath, TMethod>>;

type SuccessStatus<TStatus extends number> = `${TStatus}` extends `2${string}`
  ? TStatus
  : never;

type ErrorStatus<TStatus extends number> = `${TStatus}` extends `2${string}`
  ? never
  : TStatus;

/** A result union discriminated by both `ok` and the exact HTTP status. */
export type OperationResult<
  TSchemas extends Record<number, z.ZodType>,
  TRejectedStatus extends number = never,
> = {
  [TStatus in Exclude<keyof TSchemas & number, TRejectedStatus>]:
    | (SuccessStatus<TStatus> extends never
        ? never
        : {
            ok: true;
            status: TStatus;
            data: z.output<TSchemas[TStatus]>;
            error?: never;
          })
    | (ErrorStatus<TStatus> extends never
        ? never
        : {
            ok: false;
            status: TStatus;
            data?: never;
            error: {
              status: TStatus;
              data: z.output<TSchemas[TStatus]>;
            };
          });
}[Exclude<keyof TSchemas & number, TRejectedStatus>];

type OperationFunction = (...args: never[]) => unknown;

/** The complete input object accepted by an operation function. */
export type OperationInputOf<TOperation extends OperationFunction> =
  TOperation extends (...args: infer TArguments) => unknown
    ? TArguments extends [unknown, infer TInput, ...unknown[]]
      ? TInput
      : never
    : never;

type OperationInputMember<
  TOperation extends OperationFunction,
  TName extends "path" | "query" | "body",
> =
  OperationInputOf<TOperation> extends infer TInput
    ? TName extends keyof TInput
      ? NonNullable<TInput[TName]>
      : never
    : never;

/** The path parameters accepted by an operation function. */
export type OperationPathOf<TOperation extends OperationFunction> =
  OperationInputMember<TOperation, "path">;

/** The query parameters accepted by an operation function. */
export type OperationQueryOf<TOperation extends OperationFunction> =
  OperationInputMember<TOperation, "query">;

/** The JSON request body accepted by an operation function. */
export type OperationBodyOf<TOperation extends OperationFunction> =
  OperationInputMember<TOperation, "body">;

/** The resolved result union returned by an operation function. */
export type OperationResultOf<TOperation extends OperationFunction> = Awaited<
  ReturnType<TOperation>
>;

type OperationStatusOf<TOperation extends OperationFunction> =
  OperationResultOf<TOperation> extends {
    status: infer TStatus extends number;
  }
    ? TStatus
    : never;

/** The result variants returned by an operation for selected statuses. */
export type OperationResultForStatus<
  TOperation extends OperationFunction,
  TStatus extends OperationStatusOf<TOperation>,
> = Extract<OperationResultOf<TOperation>, { status: TStatus }>;

type OperationResponseData<TResult> = TResult extends {
  ok: true;
  data: infer TData;
}
  ? TData
  : TResult extends {
        ok: false;
        error: { data: infer TData };
      }
    ? TData
    : never;

/** The parsed response bodies returned by an operation for selected statuses. */
export type OperationResponseForStatus<
  TOperation extends OperationFunction,
  TStatus extends OperationStatusOf<TOperation>,
> = OperationResponseData<OperationResultForStatus<TOperation, TStatus>>;

/** Every error envelope returned by an operation. */
export type OperationErrorOf<TOperation extends OperationFunction> =
  Extract<OperationResultOf<TOperation>, { ok: false }> extends infer TResult
    ? TResult extends { error: infer TError }
      ? TError
      : never
    : never;

type OperationErrorStatusOf<TOperation extends OperationFunction> =
  OperationErrorOf<TOperation> extends {
    status: infer TStatus extends number;
  }
    ? TStatus
    : never;

/** The error envelopes returned by an operation for selected statuses. */
export type OperationErrorForStatus<
  TOperation extends OperationFunction,
  TStatus extends OperationErrorStatusOf<TOperation>,
> = Extract<OperationErrorOf<TOperation>, { status: TStatus }>;

/** Fetch-compatible transport called with the fully constructed request. */
export type OperationFetch = (request: Request) => Promise<Response>;

/** Transforms a request before it is passed to the configured fetch function. */
export type RequestMiddleware = (
  request: Request,
) => Request | Promise<Request>;

/** Transforms a raw response immediately after fetch returns it. */
export type ResponseMiddleware = (
  response: Response,
  request: Request,
) => Response | Promise<Response>;

/** A validated response that an application has configured as a rejection. */
export type ResponseRejection<TStatus extends number = number> = {
  data: unknown;
  method: string;
  path: string;
  status: TStatus;
};

/** Creates the error used to reject an operation for one response status. */
export type ResponseRejectionHandler<TStatus extends number = number> = (
  rejection: ResponseRejection<TStatus>,
) => Error | Promise<Error>;

/** Status-indexed handlers for responses that must reject an operation. */
export type ResponseRejectionHandlers<TStatus extends number> = {
  readonly [TCurrentStatus in TStatus]: ResponseRejectionHandler<TCurrentStatus>;
};

/** Runtime context supplied independently for each operation call. */
export type OperationContext = {
  baseUrl: string;
  headers?: HeadersInit;
  fetch?: OperationFetch;
  requestMiddleware?: readonly RequestMiddleware[];
  responseMiddleware?: readonly ResponseMiddleware[];
};
