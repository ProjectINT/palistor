import type { PlanId } from "@/config/flow";

export interface PlanOption {
  value: PlanId;
  name: string;
  price: string;
  description: string;
}

export const PLAN_OPTIONS: readonly PlanOption[] = [
  { value: "free", name: "Free", price: "$0", description: "For personal projects" },
  { value: "pro", name: "Pro", price: "$29 / mo", description: "For growing teams" },
  { value: "enterprise", name: "Enterprise", price: "Custom", description: "SSO, audit logs, dedicated support" },
];
