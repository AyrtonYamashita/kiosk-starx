import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes do Tailwind sem conflito (padrão do shadcn/Animate UI). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
