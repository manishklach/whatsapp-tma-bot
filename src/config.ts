import { z } from "zod";

const optionalUrl = z.string().trim().optional().transform((value) => value || undefined).pipe(z.string().url().optional());

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8),
  WHATSAPP_APP_SECRET: z.string().min(8),
  WHATSAPP_ACCESS_TOKEN: z.string().min(8),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  PDF_API_URL: optionalUrl,
  PDF_API_TOKEN: z.string().optional().transform((value) => value || undefined),
  PDF_API_TIMEOUT_MS: z.coerce.number().int().positive().default(30000)
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
