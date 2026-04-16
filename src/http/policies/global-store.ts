import type { Policy } from '../types';

const EMPTY_POLICIES: Policy[] = [];

export class GlobalPolicyStore {
  private policies: Policy[] = [...EMPTY_POLICIES];

  add(policy: Policy): void {
    const enforced: Policy = { ...policy, scope: 'global', enabled: true };
    const idx = this.policies.findIndex((p) => p.id === enforced.id);
    if (idx >= 0) {
      this.policies[idx] = enforced;
    } else {
      this.policies.push(enforced);
    }
  }

  remove(id: string): boolean {
    const before = this.policies.length;
    this.policies = this.policies.filter((p) => p.id !== id);
    return this.policies.length < before;
  }

  getAll(): Policy[] {
    return [...this.policies];
  }

  setAll(policies: Policy[]): void {
    this.policies = policies.map((p) => ({ ...p, scope: 'global' as const, enabled: true }));
  }

  mergeWithSession(sessionPolicies: Policy[]): Policy[] {
    const merged = new Map<string, Policy>();
    for (const p of this.policies) {
      merged.set(p.id, p);
    }
    for (const p of sessionPolicies) {
      if (!merged.has(p.id)) {
        merged.set(p.id, p);
      }
    }
    return Array.from(merged.values());
  }
}
