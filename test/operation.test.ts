import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import {
  createJsonOperationFactory,
  InvalidJsonResponseError,
  type MissingPathParameterError,
  MissingResponseBodyError,
  type OperationInputValidationError,
  OperationResponseValidationError,
  UndeclaredResponseStatusError,
} from "../src/index.js";
import type { TestPaths } from "./fixture.js";

const defineJsonOperation = createJsonOperationFactory<TestPaths>();

const productPathSchema = z.object({ product_id: z.uuid() });
const productQuerySchema = z.object({
  publish: z.boolean().optional(),
  tag: z.array(z.string()).optional(),
});
const productBodySchema = z.object({ name: z.string().trim().min(1) });
const productSchema = z.object({ id: z.string(), name: z.string() });
const badRequestSchema = z.object({
  code: z.enum(["invalid_name", "name_taken"]),
});
const notFoundSchema = z.object({ code: z.literal("not_found") });

const updateProduct = defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: productPathSchema,
  querySchema: productQuerySchema,
  bodySchema: productBodySchema,
  responses: {
    200: productSchema,
    400: badRequestSchema,
    404: notFoundSchema,
  },
});

const health = defineJsonOperation({
  path: "/health",
  method: "get",
  responses: {
    200: z.object({ status: z.literal("ok") }),
    503: z.object({ status: z.literal("unavailable") }),
  },
});

const deleteInventoryItem = defineJsonOperation({
  path: "/inventory-items/{item_id}",
  method: "delete",
  pathSchema: z.object({ item_id: z.coerce.number().int().positive() }),
  responses: {
    204: z.void(),
    404: notFoundSchema,
  },
});

const missingPathAfterTransform = defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: z
    .object({ product_id: z.string() })
    .transform(() => ({ product_id: undefined as unknown as string })),
  querySchema: productQuerySchema,
  bodySchema: productBodySchema,
  responses: {
    200: productSchema,
    400: badRequestSchema,
    404: notFoundSchema,
  },
});

const nestedQueryAfterTransform = defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: productPathSchema,
  querySchema: productQuerySchema.transform(() => ({
    publish: { nested: true } as unknown as boolean,
  })),
  bodySchema: productBodySchema,
  responses: {
    200: productSchema,
    400: badRequestSchema,
    404: notFoundSchema,
  },
});

const arrayQueryAfterTransform = defineJsonOperation({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: productPathSchema,
  querySchema: productQuerySchema.transform(
    () => [] as unknown as { publish?: boolean; tag?: string[] },
  ),
  bodySchema: productBodySchema,
  responses: {
    200: productSchema,
    400: badRequestSchema,
    404: notFoundSchema,
  },
});

const rejectedBadRequest = new Error("The application rejected status 400");
const defineJsonOperationWithRejection =
  createJsonOperationFactory<TestPaths>().withResponseRejectionHandlers({
    400: ({ data, method, path, status }) => {
      expect(data).toEqual({ code: "name_taken" });
      expect(method).toBe("PATCH");
      expect(path).toBe("/products/{product_id}");
      expect(status).toBe(400);
      return rejectedBadRequest;
    },
  });

const updateProductWithRejection = defineJsonOperationWithRejection({
  path: "/products/{product_id}",
  method: "patch",
  pathSchema: productPathSchema,
  querySchema: productQuerySchema,
  bodySchema: productBodySchema,
  responses: {
    200: productSchema,
    400: badRequestSchema,
    404: notFoundSchema,
  },
});

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

describe("defineJsonOperation", () => {
  it("validates input, renders the request, and validates a success", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (request) => {
      expect(request).toBeInstanceOf(Request);
      if (!(request instanceof Request)) {
        throw new TypeError("Expected a Request instance");
      }
      const parsed = new URL(request.url);
      expect(parsed.pathname).toBe(
        "/products/05735f1e-7069-4bbc-a110-27f194e96b1e",
      );
      expect(parsed.searchParams.get("publish")).toBe("true");
      expect(parsed.searchParams.getAll("tag")).toEqual(["featured", "sale"]);
      expect(request.method).toBe("PATCH");
      expect(request.headers.get("accept")).toBe("application/json");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(await request.json()).toEqual({ name: "Desk Lamp" });

      return jsonResponse(
        { id: "product-1", name: "Desk Lamp" },
        { status: 200 },
      );
    });

    const result = await updateProduct(
      { baseUrl: "https://api.example.test/", fetch },
      {
        path: { product_id: "05735f1e-7069-4bbc-a110-27f194e96b1e" },
        query: { publish: true, tag: ["featured", "sale"] },
        body: { name: " Desk Lamp " },
      },
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { id: "product-1", name: "Desk Lamp" },
    });
    expectTypeOf(result).toExtend<
      | {
          ok: true;
          status: 200;
          data: { id: string; name: string };
        }
      | {
          ok: false;
          status: 400;
          error: {
            status: 400;
            data: { code: "invalid_name" | "name_taken" };
          };
        }
      | {
          ok: false;
          status: 404;
          error: { status: 404; data: { code: "not_found" } };
        }
    >();
  });

  it("returns documented non-2xx responses as typed data", async () => {
    const result = await updateProduct(
      {
        baseUrl: "https://api.example.test",
        fetch: async () =>
          jsonResponse({ code: "name_taken" }, { status: 400 }),
      },
      {
        path: { product_id: "05735f1e-7069-4bbc-a110-27f194e96b1e" },
        query: {},
        body: { name: "Desk Lamp" },
      },
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: { status: 400, data: { code: "name_taken" } },
    });

    if (!result.ok && result.status === 400) {
      expectTypeOf(result.error.data.code).toEqualTypeOf<
        "invalid_name" | "name_taken"
      >();
    }
  });

  it("preserves caller headers and does not add a content type without a body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (request) => {
      if (!(request instanceof Request)) {
        throw new TypeError("Expected a Request instance");
      }
      expect(request.headers.get("accept")).toBe("application/problem+json");
      expect(request.headers.get("authorization")).toBe("Bearer token");
      expect(request.headers.has("content-type")).toBe(false);
      return jsonResponse({ status: "ok" });
    });

    await health(
      {
        baseUrl: "https://api.example.test",
        fetch,
        headers: {
          accept: "application/problem+json",
          authorization: "Bearer token",
        },
      },
      {},
    );
  });

  it("applies request middleware in order before using the custom fetch", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-middleware-order")).toBe("first, second");
      return jsonResponse({ code: "name_taken" }, { status: 400 });
    });

    await expect(
      updateProductWithRejection(
        {
          baseUrl: "https://api.example.test",
          fetch,
          requestMiddleware: [
            (request) => {
              const headers = new Headers(request.headers);
              headers.set("x-middleware-order", "first");
              return new Request(request, { headers });
            },
            async (request) => {
              const headers = new Headers(request.headers);
              headers.append("x-middleware-order", "second");
              return new Request(request, { headers });
            },
          ],
          responseMiddleware: [
            (response, request) => {
              expect(request.headers.get("x-middleware-order")).toBe(
                "first, second",
              );
              response.headers.set("x-middleware-order", "first");
              return response;
            },
            async (response) => {
              expect(response.headers.get("x-middleware-order")).toBe("first");
              response.headers.set("x-middleware-order", "first, second");
              return response;
            },
          ],
        },
        {
          path: { product_id: "05735f1e-7069-4bbc-a110-27f194e96b1e" },
          query: {},
          body: { name: "Desk Lamp" },
        },
      ),
    ).rejects.toBe(rejectedBadRequest);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("supports bodyless documented responses", async () => {
    const result = await deleteInventoryItem(
      {
        baseUrl: "https://api.example.test",
        fetch: async (request) => {
          if (!(request instanceof Request)) {
            throw new TypeError("Expected a Request instance");
          }
          expect(new URL(request.url).pathname).toBe("/inventory-items/42");
          return new Response(null, { status: 204 });
        },
      },
      { path: { item_id: "42" } },
    );

    expect(result).toEqual({ ok: true, status: 204, data: undefined });
  });

  it("wraps input validation failures with their location", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      updateProduct(
        { baseUrl: "https://api.example.test", fetch },
        {
          path: { product_id: "not-a-uuid" },
          query: {},
          body: { name: "Desk Lamp" },
        },
      ),
    ).rejects.toMatchObject({
      name: "OperationInputValidationError",
      method: "PATCH",
      path: "/products/{product_id}",
      location: "path",
    } satisfies Partial<OperationInputValidationError>);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unresolved path parameters after schema transforms", async () => {
    await expect(
      missingPathAfterTransform(
        { baseUrl: "https://api.example.test" },
        {
          path: { product_id: "product-1" },
          query: {},
          body: { name: "Desk Lamp" },
        },
      ),
    ).rejects.toMatchObject({
      parameter: "product_id",
    } satisfies Partial<MissingPathParameterError>);
  });

  it("rejects query representations it cannot serialize safely", async () => {
    const input = {
      path: { product_id: "05735f1e-7069-4bbc-a110-27f194e96b1e" },
      query: {},
      body: { name: "Desk Lamp" },
    };

    await expect(
      nestedQueryAfterTransform({ baseUrl: "https://api.example.test" }, input),
    ).rejects.toThrow("Unsupported query value for publish");

    await expect(
      arrayQueryAfterTransform({ baseUrl: "https://api.example.test" }, input),
    ).rejects.toThrow("Query parameters must be an object");
  });

  it("rejects undeclared response statuses", async () => {
    await expect(
      health(
        {
          baseUrl: "https://api.example.test",
          fetch: async () =>
            jsonResponse({ message: "created" }, { status: 201 }),
        },
        {},
      ),
    ).rejects.toBeInstanceOf(UndeclaredResponseStatusError);
  });

  it("rejects missing, invalid, and schema-invalid response bodies", async () => {
    await expect(
      health(
        {
          baseUrl: "https://api.example.test",
          fetch: async () => new Response(null, { status: 200 }),
        },
        {},
      ),
    ).rejects.toBeInstanceOf(MissingResponseBodyError);

    await expect(
      health(
        {
          baseUrl: "https://api.example.test",
          fetch: async () => new Response("not json", { status: 200 }),
        },
        {},
      ),
    ).rejects.toBeInstanceOf(InvalidJsonResponseError);

    await expect(
      health(
        {
          baseUrl: "https://api.example.test",
          fetch: async () => jsonResponse({ status: "maybe" }),
        },
        {},
      ),
    ).rejects.toBeInstanceOf(OperationResponseValidationError);
  });
});
