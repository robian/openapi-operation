import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";
import { generate as generateOrval } from "orval";
import ts from "typescript";

const httpMethods = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

type OpenApiOperation = {
  operationId?: string;
  responses?: Record<string, unknown>;
};

type OpenApiDocument = {
  [key: string]: unknown;
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>;
};

function isObject(
  value: unknown,
): value is Record<string, unknown> & { $ref?: unknown; content?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNoResponseContent(
  response: unknown,
  document: OpenApiDocument,
): boolean {
  const seen = new Set<string>();
  while (isObject(response) && typeof response.$ref === "string") {
    const reference = response.$ref;
    // External references remain owned by Orval; never infer an empty body
    // merely because a Reference Object itself has no content field.
    if (!reference.startsWith("#/")) return false;
    if (seen.has(reference))
      throw new Error(`Cyclic response reference ${reference}`);
    seen.add(reference);
    let resolved: unknown = document;
    for (const part of reference.slice(2).split("/")) {
      const key = decodeURIComponent(part)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
      resolved = isObject(resolved) ? resolved[key] : undefined;
    }
    if (!isObject(resolved))
      throw new Error(`Unresolved response reference ${reference}`);
    response = resolved;
  }
  if (!isObject(response)) return false;
  return (
    !("content" in response) ||
    (isObject(response.content) && Object.keys(response.content).length === 0)
  );
}

async function normalizeBodylessResponses(
  document: OpenApiDocument,
  zodDirectory: string,
): Promise<void> {
  const symbols = new Set<string>();
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, candidate] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue;
      const operation = candidate as OpenApiOperation;
      if (!operation.operationId) continue;
      for (const [status, response] of Object.entries(
        operation.responses ?? {},
      )) {
        if (hasNoResponseContent(response, document)) {
          symbols.add(`${pascalCase(operation.operationId)}${status}Response`);
        }
      }
    }
  }
  for (const file of await findTypeScriptFiles(zodDirectory)) {
    let source = await readFile(file, "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const replacements: { start: number; end: number }[] = [];
    for (const statement of ast.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          symbols.has(declaration.name.text) &&
          declaration.initializer
        ) {
          replacements.push({
            start: declaration.initializer.getStart(ast),
            end: declaration.initializer.end,
          });
        }
      }
    }
    // Replace only the selected response initializers, preserving other schemas
    // and their formatting. In particular, JSON schema {} remains z.unknown().
    for (const { start, end } of replacements.reverse()) {
      source = `${source.slice(0, start)}zod.void()${source.slice(end)}`;
    }
    if (replacements.length > 0) await writeFile(file, source);
  }
}

export type GenerateOpenApiOperationOptions = {
  /** OpenAPI JSON document. Relative paths are resolved from `cwd`. */
  input: string;
  /** Directory that receives `schema.ts`, `zod/`, and `operations.ts`. */
  output: string;
  /** Compare generated output without modifying the destination. */
  check?: boolean;
  /** Base directory for relative input and output paths. */
  cwd?: string;
};

function pascalCase(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("");
}

async function findTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTypeScriptFiles(entryPath)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

async function findSchemaModules(
  zodDirectory: string,
): Promise<Map<string, string>> {
  const schemaModuleBySymbol = new Map<string, string>();

  for (const schemaFile of await findTypeScriptFiles(zodDirectory)) {
    const source = await readFile(schemaFile, "utf8");
    for (const match of source.matchAll(/^export const (\w+)/gm)) {
      const symbol = match[1];
      if (!symbol) {
        continue;
      }

      const existingFile = schemaModuleBySymbol.get(symbol);
      if (existingFile && existingFile !== schemaFile) {
        throw new Error(`Duplicate generated Zod schema export ${symbol}`);
      }
      schemaModuleBySymbol.set(symbol, schemaFile);
    }
  }

  return schemaModuleBySymbol;
}

function moduleSpecifier(fromDirectory: string, modulePath: string): string {
  const relativePath = path
    .relative(fromDirectory, modulePath)
    .split(path.sep)
    .join("/")
    .replace(/\.ts$/, "");

  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

async function renderOperations(
  document: OpenApiDocument,
  outputDirectory: string,
): Promise<string> {
  const zodDirectory = path.join(outputDirectory, "zod");
  const schemaModuleBySymbol = await findSchemaModules(zodDirectory);
  const importedSymbolsByFile = new Map<string, Set<string>>();
  const definitions: string[] = [];
  const operationIds = new Set<string>();

  function schemaReference(symbol: string): string {
    const schemaFile = schemaModuleBySymbol.get(symbol);
    if (!schemaFile) {
      throw new Error(`Missing generated Zod schema ${symbol}`);
    }

    const importedSymbols = importedSymbolsByFile.get(schemaFile) ?? new Set();
    importedSymbols.add(symbol);
    importedSymbolsByFile.set(schemaFile, importedSymbols);
    return symbol;
  }

  for (const [operationPath, pathItem] of Object.entries(
    document.paths ?? {},
  )) {
    for (const [method, candidate] of Object.entries(pathItem ?? {})) {
      if (!httpMethods.has(method)) {
        continue;
      }

      const operation = candidate as OpenApiOperation;
      if (!operation.operationId) {
        throw new Error(
          `Missing operationId for ${method.toUpperCase()} ${operationPath}`,
        );
      }
      if (operationIds.has(operation.operationId)) {
        throw new Error(`Duplicate operationId ${operation.operationId}`);
      }
      operationIds.add(operation.operationId);

      const prefix = pascalCase(operation.operationId);
      const definition = [
        `  ${JSON.stringify(operation.operationId)}: defineJsonOperation({`,
        `    path: ${JSON.stringify(operationPath)},`,
        `    method: ${JSON.stringify(method)},`,
      ];

      for (const [property, suffix] of [
        ["pathSchema", "Params"],
        ["querySchema", "QueryParams"],
        ["bodySchema", "Body"],
      ] as const) {
        const symbol = `${prefix}${suffix}`;
        if (schemaModuleBySymbol.has(symbol)) {
          definition.push(`    ${property}: ${schemaReference(symbol)},`);
        }
      }

      definition.push("    responses: {");
      for (const status of Object.keys(operation.responses ?? {})) {
        if (!/^\d+$/.test(status)) {
          throw new Error(
            `Unsupported non-numeric response status ${status} for ${operation.operationId}`,
          );
        }
        const symbol = `${prefix}${status}Response`;
        definition.push(`      ${status}: ${schemaReference(symbol)},`);
      }
      definition.push("    },", "  }),");
      definitions.push(definition.join("\n"));
    }
  }

  const imports = [...importedSymbolsByFile]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([schemaFile, symbols]) => {
      const imported = [...symbols].sort().map((symbol) => `  ${symbol},`);
      const specifier = moduleSpecifier(outputDirectory, schemaFile);
      return `import {\n${imported.join("\n")}\n} from ${JSON.stringify(specifier)};`;
    });

  return `// Generated by openapi-operation. Do not edit manually.

import { createJsonOperationFactory } from "openapi-operation";

import type { paths } from "./schema";
${imports.join("\n")}

const defineJsonOperation = createJsonOperationFactory<paths>();

export const operations = {
${definitions.join("\n\n")}
} as const;
`;
}

async function generateInto(
  inputPath: string,
  outputDirectory: string,
  workspace: string,
) {
  await mkdir(outputDirectory, { recursive: true });

  const schemaAst = await openapiTS(pathToFileURL(inputPath), {
    alphabetize: true,
    enumValues: true,
    rootTypes: true,
    rootTypesNoSchemaPrefix: true,
  });
  await writeFile(
    path.join(outputDirectory, "schema.ts"),
    astToString(schemaAst),
  );

  const zodDirectory = path.join(outputDirectory, "zod");
  await generateOrval(
    {
      input: { target: inputPath },
      output: {
        target: path.join(zodDirectory, "schemas.ts"),
        client: "zod",
        mode: "tags-split",
        clean: true,
        override: {
          zod: {
            version: 4,
            generateEachHttpStatus: true,
            strict: {
              body: true,
              response: false,
            },
          },
        },
      },
    },
    workspace,
  );

  const document = JSON.parse(
    await readFile(inputPath, "utf8"),
  ) as OpenApiDocument;
  await normalizeBodylessResponses(document, zodDirectory);
  await writeFile(
    path.join(outputDirectory, "operations.ts"),
    await renderOperations(document, outputDirectory),
  );
}

async function readOutput(directory: string): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  const topLevelFiles = ["operations.ts", "schema.ts"];

  for (const file of topLevelFiles) {
    output.set(file, await readFile(path.join(directory, file), "utf8"));
  }
  for (const file of await findTypeScriptFiles(path.join(directory, "zod"))) {
    output.set(
      path.relative(directory, file).split(path.sep).join("/"),
      await readFile(file, "utf8"),
    );
  }

  return output;
}

function outputsEqual(
  actual: Map<string, string>,
  expected: Map<string, string>,
): boolean {
  if (actual.size !== expected.size) {
    return false;
  }

  for (const [file, contents] of expected) {
    if (actual.get(file) !== contents) {
      return false;
    }
  }

  return true;
}

async function replaceGeneratedOutput(
  generatedDirectory: string,
  outputDirectory: string,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    ["operations.ts", "schema.ts"].map((file) =>
      cp(path.join(generatedDirectory, file), path.join(outputDirectory, file)),
    ),
  );

  const zodOutput = path.join(outputDirectory, "zod");
  await rm(zodOutput, { recursive: true, force: true });
  await cp(path.join(generatedDirectory, "zod"), zodOutput, {
    recursive: true,
  });
}

/** Generate a complete operation contract from a FastAPI OpenAPI JSON file. */
export async function generateOpenApiOperations(
  options: GenerateOpenApiOperationOptions,
): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const inputPath = path.resolve(cwd, options.input);
  const outputDirectory = path.resolve(cwd, options.output);
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "openapi-operation-"),
  );

  try {
    await generateInto(inputPath, temporaryDirectory, cwd);

    if (options.check) {
      let actual: Map<string, string>;
      try {
        actual = await readOutput(outputDirectory);
      } catch {
        throw new Error(
          `Generated OpenAPI operation output is missing or stale: ${outputDirectory}`,
        );
      }

      if (!outputsEqual(actual, await readOutput(temporaryDirectory))) {
        throw new Error(
          `Generated OpenAPI operation output is stale: ${outputDirectory}`,
        );
      }
      return;
    }

    await replaceGeneratedOutput(temporaryDirectory, outputDirectory);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
