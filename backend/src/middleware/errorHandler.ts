import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new HttpError(404, `Route not found: ${request.method} ${request.path}`));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Invalid request",
      details: error.flatten(),
    });
    return;
  }

  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  response.status(statusCode).json({
    error: statusCode === 500 ? "Internal server error" : error.message,
  });
};
