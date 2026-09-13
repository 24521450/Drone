import { z } from "zod";

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid resource ID");
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Must be a real calendar date");
export const paginationFields = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const optionalObjectId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  objectId.optional(),
);
export const optionalIsoDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  isoDate.optional(),
);
export const dateFields = {
  dateFrom: optionalIsoDate,
  dateTo: optionalIsoDate,
};
export const timezoneOffsetField = z.coerce
  .number()
  .int()
  .min(-840)
  .max(840)
  .default(0);
export const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function dateRange(
  dateFrom?: string,
  dateTo?: string,
  timezoneOffsetMinutes = 0,
) {
  const range: { $gte?: Date; $lte?: Date } = {};
  if (dateFrom)
    range.$gte = new Date(
      new Date(`${dateFrom}T00:00:00.000Z`).getTime() +
        timezoneOffsetMinutes * 60_000,
    );
  if (dateTo)
    range.$lte = new Date(
      new Date(`${dateTo}T23:59:59.999Z`).getTime() +
        timezoneOffsetMinutes * 60_000,
    );
  return range;
}

/** Convert Date#getTimezoneOffset() semantics to MongoDB's +HH:MM timezone format. */
export function mongoTimezoneOffset(timezoneOffsetMinutes: number) {
  const absolute = Math.abs(timezoneOffsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${timezoneOffsetMinutes <= 0 ? "+" : "-"}${hours}:${minutes}`;
}
