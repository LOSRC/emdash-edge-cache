/**
 * A stand-in for `cloudflare:workers` under Node (vitest.config.ts aliases it). Like the real
 * `WorkerEntrypoint`, it keeps the execution context and the environment it is constructed with.
 */
export class WorkerEntrypoint<Env = unknown> {
  protected ctx: ExecutionContext
  protected env: Env
  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
