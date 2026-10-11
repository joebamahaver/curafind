import { z } from "zod";

export const trialLocationSchema = z.object({
  zipCode: z.string({ error: "Enter a five-digit U.S. ZIP code." }).trim()
    .regex(/^\d{5}$/, "Enter a five-digit U.S. ZIP code."),
  travelDistanceMiles: z.number({ error: "Enter how far you are willing to travel in miles." })
    .min(1, "Travel distance must be at least 1 mile.")
    .max(10000, "Travel distance must be no more than 10,000 miles."),
});
