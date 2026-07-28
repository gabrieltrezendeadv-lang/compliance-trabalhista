import { z } from "zod";

const optionalUuid = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().uuid().optional()
);

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(200).optional()
);

export const createEmployeeSchema = z
  .object({
    full_name: z.string().trim().min(2, "Informe o nome do colaborador").max(200),
    email: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().email("Informe um e-mail válido").optional()
    ),
    phone: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z
        .string()
        .trim()
        .regex(/^\+?[1-9]\d{9,14}$/, "Use DDI e DDD, somente números")
        .optional()
    ),
    job_title: optionalText,
    establishment_id: optionalUuid,
    department_id: optionalUuid,
    hire_date: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    ),
  })
  .strict()
  .refine((data) => data.email || data.phone, {
    message: "Informe ao menos e-mail ou telefone para envio das campanhas",
    path: ["email"],
  });

export type CreateEmployee = z.infer<typeof createEmployeeSchema>;

