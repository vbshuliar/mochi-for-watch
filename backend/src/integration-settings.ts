import { AppError } from "./domain.ts";
import type { Store } from "./store.ts";

export const integrationIDs = [
  "google-calendar",
  "gmail",
  "notion",
  "instagram",
  "facebook",
  "safari",
] as const;
export type IntegrationID = (typeof integrationIDs)[number];
export const integrationKey = (id: IntegrationID) =>
  id === "google-calendar" ? "calendar-enabled" : `${id}-enabled`;
export const integrationEnabled = (store: Store, id: IntegrationID) =>
  store.get<boolean>("integration", integrationKey(id)) !== false;
export function requireIntegrationEnabled(store: Store, id: IntegrationID) {
  if (!integrationEnabled(store, id))
    throw new AppError(
      409,
      "integration_disabled",
      "This service is switched off. Enable it in Connections to use it.",
    );
}
