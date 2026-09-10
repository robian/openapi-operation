import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
