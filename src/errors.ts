/** The location of an invalid operation input. */
export type OperationInputLocation = "path" | "query" | "body";

/** Base class for errors raised while preparing or interpreting an operation. */
export abstract class OpenApiOperationError extends Error {
  readonly method: string;
  readonly path: string;

  protected constructor(
    message: string,
    method: string,
    path: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
    this.method = method;
    this.path = path;
  }
}

/** Raised when an input does not match its declared runtime schema. */
export class OperationInputValidationError extends OpenApiOperationError {
  readonly location: OperationInputLocation;

  constructor(
    method: string,
    path: string,
    location: OperationInputLocation,
    cause: unknown,
  ) {
    super(`Invalid ${location} input for ${method} ${path}`, method, path, {
      cause,
    });
    this.location = location;
  }
}

/** Raised when a templated path parameter remains unresolved after validation. */
export class MissingPathParameterError extends OpenApiOperationError {
  readonly parameter: string;

  constructor(method: string, path: string, parameter: string) {
    super(
      `Missing path parameter ${parameter} for ${method} ${path}`,
      method,
      path,
    );
    this.parameter = parameter;
  }
}

/** Raised when the server returns a status absent from the operation contract. */
export class UndeclaredResponseStatusError extends OpenApiOperationError {
  readonly status: number;

  constructor(method: string, path: string, status: number) {
    super(
      `Received undeclared status ${status} from ${method} ${path}`,
      method,
      path,
    );
    this.status = status;
  }
}

/** Raised when a response that should contain JSON has no body. */
export class MissingResponseBodyError extends OpenApiOperationError {
  readonly status: number;

  constructor(method: string, path: string, status: number) {
    super(
      `Missing response body for ${method} ${path} (${status})`,
      method,
      path,
    );
    this.status = status;
  }
}

/** Raised when a response declared bodyless contains a body. */
export class UnexpectedResponseBodyError extends OpenApiOperationError {
  readonly status: number;

  constructor(method: string, path: string, status: number) {
    super(
      `Unexpected response body for ${method} ${path} (${status})`,
      method,
      path,
    );
    this.status = status;
  }
}

/** Raised when a response body is not valid JSON. */
export class InvalidJsonResponseError extends OpenApiOperationError {
  readonly status: number;

  constructor(method: string, path: string, status: number, cause: unknown) {
    super(
      `Invalid JSON response from ${method} ${path} (${status})`,
      method,
      path,
      {
        cause,
      },
    );
    this.status = status;
  }
}

/** Raised when response JSON does not match its status-specific schema. */
export class OperationResponseValidationError extends OpenApiOperationError {
  readonly status: number;

  constructor(method: string, path: string, status: number, cause: unknown) {
    super(`Invalid response from ${method} ${path} (${status})`, method, path, {
      cause,
    });
    this.status = status;
  }
}
