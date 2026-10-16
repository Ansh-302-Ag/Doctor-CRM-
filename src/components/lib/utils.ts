import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class merge used by the Lightswind components (their import path, kept as is). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
