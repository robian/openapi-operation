export interface TestPaths {
  "/response-bodies": {
    get: {
      responses: {
        200: { content?: never };
        201: { content: never };
        202: { content: { "application/json": unknown } };
        204: { content: never };
        400: { content?: never };
      };
    };
    head: { responses: { 200: { content?: never } } };
  };
  "/products/{product_id}": {
    patch: {
      parameters: {
        path: { product_id: string };
        query: { publish?: boolean; tag?: string[] };
      };
      requestBody: {
        content: {
          "application/json": { name: string };
        };
      };
      responses: {
        200: {
          content: {
            "application/json": { id: string; name: string };
          };
        };
        400: {
          content: {
            "application/json": {
              code: "invalid_name" | "name_taken";
            };
          };
        };
        404: {
          content: {
            "application/json": { code: "not_found" };
          };
        };
      };
    };
  };
  "/health": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": { status: "ok" };
          };
        };
        503: {
          content: {
            "application/json": { status: "unavailable" };
          };
        };
      };
    };
  };
  "/inventory-items/{item_id}": {
    delete: {
      parameters: {
        path: { item_id: number };
      };
      responses: {
        204: {
          content: never;
        };
        404: {
          content: {
            "application/json": { code: "not_found" };
          };
        };
      };
    };
  };
}
