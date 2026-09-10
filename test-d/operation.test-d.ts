import { z } from "zod";
import type {
  OperationErrorForStatus,
  OperationErrorOf,
  OperationResponseForStatus,
  OperationResultForStatus,
  OperationResultOf,
} from "../src/index.js";
import { createJsonOperationFactory } from "../src/index.js";
import type { TestPaths } from "../test/fixture.js";

const defineJsonOperation = createJsonOperationFactory<TestPaths>();
const defineJsonOperationWithRejection =
  createJsonOperationFactory<TestPaths>().withResponseRejectionHandlers({
    400: ({ status }) => {
      status satisfies number;
      return new Error("Rejected bad request");
    },
  });
const success = z.object({ id: z.string(), name: z.string() });
const badRequest = z.object({
  code: z.enum(["invalid_name", "name_taken"]),
});
const notFound = z.object({ code: z.literal("not_found") });

defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z.object({ product_id: z.string() }),
  querySchema: z.object({
    publish: z.boolean().optional(),
    tag: z.array(z.string()).optional(),
  }),
  bodySchema: z.object({ name: z.string() }),
  responses: { 200: success, 400: badRequest, 404: notFound },
});

defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z.object({ product_id: z.string() }),
  querySchema: z.object({}),
  bodySchema: z.object({ name: z.string() }),
  // @ts-expect-error every documented response status must have a schema
  responses: { 200: success, 400: badRequest },
});

defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z.object({ product_id: z.string() }),
  querySchema: z.object({}),
  bodySchema: z.object({ name: z.string() }),
  responses: {
    200: success,
    400: badRequest,
    404: notFound,
    // @ts-expect-error undocumented response statuses are rejected
    409: z.object({ code: z.literal("conflict") }),
  },
});

defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z.object({ product_id: z.string() }),
  querySchema: z.object({}),
  bodySchema: z.object({ name: z.string() }),
  responses: {
    200: success,
    // @ts-expect-error a stale enum schema cannot omit a documented reason
    400: z.object({ code: z.literal("invalid_name") }),
    404: notFound,
  },
});

defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z.object({ product_id: z.string() }),
  querySchema: z.object({}),
  bodySchema: z.object({ name: z.string() }),
  responses: {
    // @ts-expect-error schema output must agree with the OpenAPI response body
    200: z.object({ id: z.number(), name: z.string() }),
    400: badRequest,
    404: notFound,
  },
});

defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  // @ts-expect-error request schemas must agree with OpenAPI parameters
  pathSchema: z.object({ product_id: z.number() }),
  querySchema: z.object({}),
  bodySchema: z.object({ name: z.string() }),
  responses: { 200: success, 400: badRequest, 404: notFound },
});

// @ts-expect-error only methods documented for this path are accepted
defineJsonOperation({ path: "/health", method: "post", responses: {} });

// @ts-expect-error only paths in the OpenAPI contract are accepted
defineJsonOperation({ path: "/missing", method: "get", responses: {} });

const operation = defineJsonOperation({
  path: "/health",
  method: "get",
  responses: {
    200: z.object({ status: z.literal("ok") }),
    503: z.object({ status: z.literal("unavailable") }),
  },
});

type HealthResult = OperationResultOf<typeof operation>;
declare const healthResult: HealthResult;
healthResult.status satisfies 200 | 503;

type Health200Result = OperationResultForStatus<typeof operation, 200>;
declare const health200Result: Health200Result;
health200Result.ok satisfies true;
health200Result.data.status satisfies "ok";

type Health200Response = OperationResponseForStatus<typeof operation, 200>;
declare const health200Response: Health200Response;
health200Response.status satisfies "ok";

type Health503Response = OperationResponseForStatus<typeof operation, 503>;
declare const health503Response: Health503Response;
health503Response.status satisfies "unavailable";

type HealthError = OperationErrorOf<typeof operation>;
declare const healthError: HealthError;
healthError.status satisfies 503;
healthError.data.status satisfies "unavailable";

type Health503Error = OperationErrorForStatus<typeof operation, 503>;
declare const health503Error: Health503Error;
health503Error.status satisfies 503;
health503Error.data.status satisfies "unavailable";

// @ts-expect-error the operation does not document status 404
type MissingResult = OperationResultForStatus<typeof operation, 404>;
declare const missingResult: MissingResult;
void missingResult;
// @ts-expect-error successful statuses are not error statuses
type SuccessfulError = OperationErrorForStatus<typeof operation, 200>;
declare const successfulError: SuccessfulError;
void successfulError;

const operationWithDefaultQuery = defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z.object({ product_id: z.string() }),
  querySchema: z
    .object({
      publish: z.boolean().optional(),
      tag: z.array(z.string()).optional(),
    })
    .default({}),
  bodySchema: z.object({ name: z.string() }),
  responses: { 200: success, 400: badRequest, 404: notFound },
});

const operationWithRejection = defineJsonOperationWithRejection({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z.object({ product_id: z.string() }),
  querySchema: z.object({}),
  bodySchema: z.object({ name: z.string() }),
  responses: { 200: success, 400: badRequest, 404: notFound },
});

operationWithDefaultQuery(
  { baseUrl: "https://example.test" },
  {
    path: { product_id: "product-1" },
    body: { name: "Desk Lamp" },
  },
);

async function consumeResult(): Promise<void> {
  const result = await operation({ baseUrl: "https://example.test" }, {});

  if (result.status === 200) {
    result.data.status satisfies "ok";
    // @ts-expect-error success results have no error payload
    result.error.data;
  } else {
    result.error.data.status satisfies "unavailable";
    // @ts-expect-error error results have no success data
    result.data.status;
  }
}

void consumeResult;

async function consumeResultWithRejection(): Promise<void> {
  const result = await operationWithRejection(
    { baseUrl: "https://example.test" },
    {
      path: { product_id: "product-1" },
      query: {},
      body: { name: "Desk Lamp" },
    },
  );

  result.status satisfies 200 | 404;
  // @ts-expect-error rejected response statuses are absent from the result
  result.status satisfies 400;
}

void consumeResultWithRejection;
