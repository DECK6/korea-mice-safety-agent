import { ZodError } from "zod";

export function toMcpErrorContent(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (err instanceof ZodError) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              code: "INVALID_INPUT",
              message: "Input validation failed",
              details: err.issues.map((issue) => ({
                path: issue.path.join(".") || "(root)",
                message: issue.message,
                code: issue.code,
              })),
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: JSON.stringify({ code: "INTERNAL", message }, null, 2) }],
    isError: true,
  };
}

