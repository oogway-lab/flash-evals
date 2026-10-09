export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export class ApiBadRequestError extends ApiError {
    constructor(message = "Bad request") {
        super(400, "bad_request", message);
        this.name = "ApiBadRequestError";
    }
}

export class ApiFieldValidationError extends ApiError {
    constructor(
        message: string,
        public readonly path: string,
        public readonly remediation: string,
    ) {
        super(400, "invalid_llm_routing", message);
        this.name = "ApiFieldValidationError";
    }
}

export class ApiConflictError extends ApiError {
    constructor(message = "Conflict") {
        super(409, "conflict", message);
        this.name = "ApiConflictError";
    }
}

export class ApiForbiddenError extends ApiError {
    constructor(message = "Forbidden") {
        super(403, "forbidden", message);
        this.name = "ApiForbiddenError";
    }
}

export class ApiPayloadTooLargeError extends ApiError {
    constructor(message = "Payload too large") {
        super(413, "payload_too_large", message);
        this.name = "ApiPayloadTooLargeError";
    }
}

export class ApiNotFoundError extends ApiError {
    constructor(message = "Not found") {
        super(404, "not_found", message);
        this.name = "ApiNotFoundError";
    }
}

export class ApiRateLimitedError extends ApiError {
    constructor(
        message: string,
        public readonly retryAfterSeconds: number,
    ) {
        super(429, "rate_limited", message);
        this.name = "ApiRateLimitedError";
    }
}

export class ApiServiceUnavailableError extends ApiError {
    constructor(message = "Service unavailable") {
        super(503, "service_unavailable", message);
        this.name = "ApiServiceUnavailableError";
    }
}
