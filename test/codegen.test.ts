import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { generateOpenApiOperations } from "../src/codegen.js";

const fixture = fileURLToPath(
  new URL("./fixtures/products-openapi.json", import.meta.url),
);

describe("generateOpenApiOperations", () => {
  it("generates types, Zod schemas, and exhaustive operation definitions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "operation-codegen-"));

    await generateOpenApiOperations({ input: fixture, output: directory });

    const schema = await readFile(path.join(directory, "schema.ts"), "utf8");
    const zod = await readFile(
      path.join(directory, "zod/products/products.ts"),
      "utf8",
    );
    const operationsPath = path.join(directory, "operations.ts");
    const operations = await readFile(operationsPath, "utf8");

    expect(schema).toContain('"/products/{product_id}"');
    expect(zod).toContain("UpdateProducts200Response");
    expect(zod).toContain("UpdateProducts400Response");
    expect(zod).toContain("UpdateProducts404Response");
    expect(operations).toContain('"update_products": defineJsonOperation({');
    expect(operations).toContain('path: "/products/{product_id}"');
    expect(operations).toContain("pathSchema: UpdateProductsParams");
    expect(operations).toContain("querySchema: UpdateProductsQueryParams");
    expect(operations).toContain("bodySchema: UpdateProductsBody");
    expect(operations).toContain("200: UpdateProducts200Response");
    expect(operations).toContain("400: UpdateProducts400Response");
    expect(operations).toContain("404: UpdateProducts404Response");

    // Execute the generated schemas so this checks their behavior, not just
    // whether the generator emitted a particular Zod constructor.
    const compiled = ts.transpileModule(zod, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    });
    const schemas = runInNewContext(`${compiled.outputText}\nexports;`, {
      exports: {},
      require: createRequire(import.meta.url),
    }) as {
      UpdateProducts200Response: z.ZodType;
      UpdateProducts400Response: z.ZodType;
      UpdateProducts404Response: z.ZodType;
      UpdateProductsBody: z.ZodType;
    };
    const success = schemas.UpdateProducts200Response;
    expect(
      success.parse({
        id: "product-1",
        name: "Product",
        secret: "do not forward",
        details: { label: "Details", secret: "nested secret" },
        variants: [{ kind: "stock", quantity: 2, secret: "array secret" }],
        counts: { warehouse: 3 },
      }),
    ).toEqual({
      id: "product-1",
      name: "Product",
      details: { label: "Details" },
      variants: [{ kind: "stock", quantity: 2 }],
      counts: { warehouse: 3 },
    });
    for (const invalid of [
      { id: "product-1" },
      { id: "product-1", name: 42 },
      { id: "product-1", name: "Product", details: { label: "" } },
      {
        id: "product-1",
        name: "Product",
        variants: [{ kind: "stock", quantity: -1 }],
      },
      {
        id: "product-1",
        name: "Product",
        variants: [{ kind: "new_kind", quantity: 2 }],
      },
      {
        id: "product-1",
        name: "Product",
        variants: [{ kind: "download", url: "not a URL" }],
      },
      { id: "product-1", name: "Product", counts: { warehouse: "three" } },
    ]) {
      expect(success.safeParse(invalid).success).toBe(false);
    }
    expect(
      schemas.UpdateProducts400Response.parse({
        reason: "invalid_name",
        secret: "do not forward",
      }),
    ).toEqual({ reason: "invalid_name" });
    expect(
      schemas.UpdateProducts404Response.parse({
        reason: "not_found",
        secret: "do not forward",
      }),
    ).toEqual({ reason: "not_found" });
    expect(
      schemas.UpdateProducts400Response.safeParse({ reason: "new_reason" })
        .success,
    ).toBe(false);
    expect(
      schemas.UpdateProducts404Response.safeParse({ reason: "invalid_name" })
        .success,
    ).toBe(false);
    expect(
      schemas.UpdateProductsBody.safeParse({ name: "Product", extra: true })
        .success,
    ).toBe(false);
    expect(schemas.UpdateProductsBody.safeParse({ name: "" }).success).toBe(
      false,
    );

    await expect(
      generateOpenApiOperations({
        input: fixture,
        output: directory,
        check: true,
      }),
    ).resolves.toBeUndefined();

    await writeFile(operationsPath, "stale");
    await expect(
      generateOpenApiOperations({
        input: fixture,
        output: directory,
        check: true,
      }),
    ).rejects.toThrow("output is stale");
  });

  it("reports missing generated output in check mode", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "operation-codegen-"));

    await expect(
      generateOpenApiOperations({
        input: fixture,
        output: path.join(directory, "missing"),
        check: true,
      }),
    ).rejects.toThrow("output is missing or stale");
  });
});
