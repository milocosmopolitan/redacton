import { type ConfigDocument, freezeDocument } from './config.ts';
export type SavedScope = 'personal' | 'project';
export interface SavedConfiguration {
  readonly scope: SavedScope;
  readonly identity: string;
  readonly revision: string;
  readonly document: ConfigDocument;
}
export interface SaveIntent {
  readonly token: string;
  readonly scope: SavedScope;
  readonly identity: string;
  readonly expectedRevision: string;
  readonly document: ConfigDocument;
}
// The host supplies only validated helper receipts. Project data remains unapproved
// until a local review explicitly grants trust for the exact loaded revision.
let settingsSequence = 0;
export class SavedSettingsController {
  private readonly identity = ++settingsSequence;
  private loaded = new Map<SavedScope, SavedConfiguration>();
  private approved = new Map<SavedScope, string>();
  private pending: SaveIntent | undefined;
  private epoch = 0;
  private pendingBase: ConfigDocument | undefined;
  resetSession(): void {
    this.loaded.clear();
    this.approved.clear();
    this.pending = undefined;
    this.pendingBase = undefined;
  }
  loadedConfiguration(scope: SavedScope): SavedConfiguration | undefined {
    return this.loaded.get(scope);
  }
  observe(value: SavedConfiguration): void {
    const prior = this.loaded.get(value.scope);
    const safe = Object.freeze({
      scope: value.scope,
      identity: value.identity,
      revision: value.revision,
      document: freezeDocument(value.document),
    });
    this.loaded.set(value.scope, safe);
    if (value.scope === 'personal')
      this.approved.set(value.scope, value.revision);
    else if (
      prior?.identity !== value.identity ||
      prior.revision !== value.revision ||
      JSON.stringify(prior.document) !== JSON.stringify(safe.document)
    )
      this.approved.delete(value.scope);
  }
  approveProject(
    identity: string,
    revision: string,
    reviewed: ConfigDocument,
  ): boolean {
    const value = this.loaded.get('project');
    if (
      !value ||
      value.identity !== identity ||
      value.revision !== revision ||
      JSON.stringify(value.document) !==
        JSON.stringify(freezeDocument(reviewed))
    )
      return false;
    this.approved.set('project', revision);
    return true;
  }
  approvedLayers(): Readonly<{
    personal?: ConfigDocument;
    project?: ConfigDocument;
  }> {
    const result: { personal?: ConfigDocument; project?: ConfigDocument } = {};
    for (const scope of ['personal', 'project'] as const) {
      const saved = this.loaded.get(scope);
      if (saved && this.approved.get(scope) === saved.revision)
        result[scope] = saved.document;
    }
    return Object.freeze(result);
  }
  beginSave(scope: SavedScope, document: ConfigDocument): SaveIntent | null {
    const saved = this.loaded.get(scope);
    if (
      !saved ||
      (scope === 'project' && this.approved.get(scope) !== saved.revision)
    )
      return null;
    this.epoch += 1;
    this.pendingBase = saved.document;
    this.pending = Object.freeze({
      token: `save-${this.identity}-${this.epoch}`,
      scope,
      identity: saved.identity,
      expectedRevision: saved.revision,
      document: freezeDocument(document),
    });
    return this.pending;
  }
  cancel(token: string): void {
    if (this.pending?.token === token) {
      this.pending = undefined;
      this.pendingBase = undefined;
    }
  }
  saved(token: string, receipt: SavedConfiguration): boolean {
    const pending = this.pending;
    const current = pending && this.loaded.get(pending.scope);
    if (
      !pending ||
      pending.token !== token ||
      !current ||
      current.revision !== pending.expectedRevision ||
      current.identity !== pending.identity ||
      JSON.stringify(current.document) !== JSON.stringify(this.pendingBase) ||
      receipt.scope !== pending.scope ||
      receipt.identity !== pending.identity ||
      receipt.revision === pending.expectedRevision
    )
      return false;
    // Match the declarative payload as well as the privileged write identity.
    if (
      JSON.stringify(freezeDocument(receipt.document)) !==
      JSON.stringify(pending.document)
    )
      return false;
    this.observe(receipt);
    this.approved.set(receipt.scope, receipt.revision);
    this.pending = undefined;
    this.pendingBase = undefined;
    return true;
  }
}

export interface ImportCandidate {
  readonly token: string;
  readonly scope: SavedScope;
  readonly identity: string;
  readonly document: ConfigDocument;
}
let importSequence = 0;
export class ImportReviewController {
  private readonly identity = ++importSequence;
  private epoch = 0;
  private candidate: ImportCandidate | undefined;
  private approvedToken: string | undefined;
  stage(
    scope: SavedScope,
    identity: string,
    document: ConfigDocument,
  ): ImportCandidate {
    this.epoch += 1;
    this.approvedToken = undefined;
    this.candidate = Object.freeze({
      token: `import-${this.identity}-${this.epoch}`,
      scope,
      identity,
      document: freezeDocument(document),
    });
    return this.candidate;
  }
  snapshot(): ImportCandidate | undefined {
    return this.candidate;
  }
  approve(token: string, reviewed: ConfigDocument): boolean {
    const candidate = this.candidate;
    if (
      !candidate ||
      candidate.token !== token ||
      JSON.stringify(candidate.document) !==
        JSON.stringify(freezeDocument(reviewed))
    )
      return false;
    this.approvedToken = token;
    return true;
  }
  approved(token: string): ConfigDocument | null {
    return this.candidate?.token === token && this.approvedToken === token
      ? this.candidate.document
      : null;
  }
  cancel(): void {
    this.candidate = undefined;
    this.approvedToken = undefined;
  }
}
