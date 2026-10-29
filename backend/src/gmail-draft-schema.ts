import { z } from "zod";
export const email = z
  .email()
  .max(254)
  .regex(/^[\x21-\x7e]+$/);
export const gmailDraftInputSchema = z
  .object({
    to: email,
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    body: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+$/),
  })
  .strict();
