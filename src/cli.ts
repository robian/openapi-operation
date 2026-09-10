#!/usr/bin/env node

import { generateOpenApiOperations } from "./codegen.js";

function readOption(arguments_: string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
}

function usage(): string {
  return `Usage:
  openapi-operation generate --input <openapi.json> --output <directory>
  openapi-operation generate --input <openapi.json> --output <directory> --check`;
}

async function main(arguments_: string[]): Promise<void> {
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    console.log(usage());
    return;
  }

  const [command] = arguments_;
  const input = readOption(arguments_, "--input");
  const output = readOption(arguments_, "--output");
  if (command !== "generate" || !input || !output) {
    throw new Error(usage());
  }

  await generateOpenApiOperations({
    input,
    output,
    check: arguments_.includes("--check"),
  });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
