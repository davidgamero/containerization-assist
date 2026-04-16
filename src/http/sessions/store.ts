import { randomUUID } from 'node:crypto';
import type {
  ArtifactTag,
  Policy,
  PolicyResult,
  Session,
  SessionArtifact,
  SessionEvent,
  SessionPhase,
  SessionPolicies,
} from '../types';
import { SESSION_PHASE } from '../types';

type EventListener = (event: SessionEvent) => void;

const EMPTY_POLICIES: SessionPolicies = { policies: [], results: [] };

export class SessionStore {
  private sessions = new Map<string, Session>();
  private listeners = new Map<string, Set<EventListener>>();
  private eventHistory = new Map<string, SessionEvent[]>();

  create(
    source: Session['source'],
    workspacePath: string,
    policies?: SessionPolicies | undefined,
  ): Session {
    const session: Session = {
      id: randomUUID(),
      phase: SESSION_PHASE.PENDING,
      source,
      workspacePath,
      policies: policies ?? EMPTY_POLICIES,
      artifacts: [],
      logs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  updatePhase(id: string, phase: SessionPhase, error?: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.phase = phase;
    session.updatedAt = new Date();
    if (error !== undefined) session.error = error;

    this.emit(id, {
      type: 'phase_change',
      sessionId: id,
      phase,
      ...(error !== undefined && { message: error }),
      timestamp: new Date(),
    });
  }

  addArtifact(
    id: string,
    phase: SessionPhase,
    name: string,
    content: string,
    contentType = 'application/json',
    tag?: ArtifactTag | undefined,
  ): SessionArtifact {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    const existing = session.artifacts.filter((a) => a.name === name);
    const artifact: SessionArtifact = {
      id: randomUUID(),
      sessionId: id,
      phase,
      name,
      contentType,
      ...(tag !== undefined && { tag }),
      content,
      version: existing.length + 1,
      createdAt: new Date(),
    };

    session.artifacts.push(artifact);
    session.updatedAt = new Date();

    this.emit(id, {
      type: 'artifact',
      sessionId: id,
      phase,
      artifactId: artifact.id,
      message: `${name} v${artifact.version}`,
      timestamp: new Date(),
    });

    return artifact;
  }

  addLog(id: string, message: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.logs.push(message);
    session.updatedAt = new Date();

    this.emit(id, {
      type: 'log',
      sessionId: id,
      message,
      timestamp: new Date(),
    });
  }

  addPolicyResults(id: string, results: PolicyResult[]): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.policies.results.push(...results);
    session.updatedAt = new Date();

    for (const result of results) {
      this.emit(id, {
        type: 'policy_result',
        sessionId: id,
        phase: result.phase,
        result,
        message: `Policy "${result.policyName}" → ${result.outcome} (${result.artifactName})`,
        timestamp: new Date(),
      });
    }
  }

  updatePolicies(id: string, policies: Policy[]): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.policies = { policies, results: session.policies.results };
    session.updatedAt = new Date();
  }

  subscribe(sessionId: string, listener: EventListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(sessionId);
    };
  }

  getEventHistory(sessionId: string): SessionEvent[] {
    return this.eventHistory.get(sessionId) ?? [];
  }

  private emit(sessionId: string, event: SessionEvent): void {
    let history = this.eventHistory.get(sessionId);
    if (!history) {
      history = [];
      this.eventHistory.set(sessionId, history);
    }
    if (history.length < 500) {
      history.push(event);
    }

    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Listener errors must not break the pipeline.
      }
    }
  }

  delete(id: string): void {
    this.sessions.delete(id);
    this.listeners.delete(id);
    this.eventHistory.delete(id);
  }
}
