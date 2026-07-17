import type {
  ExtensionSettings,
  PageDisplayMode,
  PageTranslationState,
  TranslationErrorPayload,
  TranslationSegment,
} from '../types/domain';
import {
  isPageBlockElement,
  parsePageParagraphs,
  type ParsedParagraph,
} from './page-dom-parser';
import { createPageFragmentPlan } from './page-fragmenter';
import {
  insertParagraphTranslation,
  isNiraTranslationNode,
  removeParagraphTranslation,
  setParagraphDisplayMode,
  updateParagraphTranslation,
  type RenderedParagraph,
} from './page-renderer';
import { cancelTranslation, createJobId, requestTranslation } from './messaging';

const MAX_BATCH_SEGMENTS = 4;
const MAX_BATCH_CHARACTERS = 4_000;
const MAX_CONCURRENCY = 2;
const MAX_MISSING_SEGMENT_RETRIES = 2;
const MUTATION_CONSUME_MS = 50;

type ParagraphStatus = 'observed' | 'queued' | 'translating' | 'translated';

interface ParagraphRecord {
  id: string;
  segmentId: string;
  paragraph: ParsedParagraph;
  status: ParagraphStatus;
  rendered: RenderedParagraph | null;
  translatedText: string | null;
  fragments: string[];
  fragmentJoiners: string[];
  translatedFragments: string[];
  preserveStructure: boolean;
  generation: number;
}

interface WorkItem {
  record: ParagraphRecord;
  segment: TranslationSegment;
  fragmentIndex: number;
  attempt: number;
}

interface RuntimeError extends Error {
  payload?: TranslationErrorPayload;
}

export class PageTranslator {
  private settings: ExtensionSettings;
  private readonly records = new Map<string, ParagraphRecord>();
  private readonly sourceIndex = new WeakMap<Node, ParagraphRecord>();
  private readonly translationIndex = new WeakMap<Node, ParagraphRecord>();
  private readonly ancestorRecords = new Map<HTMLElement, Set<string>>();
  private readonly intersectionRecords = new Map<Element, Set<string>>();
  private observedMutationRoots = new WeakSet<Node>();
  private readonly queue: WorkItem[] = [];
  private readonly queuedIds = new Set<string>();
  private readonly activeJobs = new Set<string>();
  private readonly activeBatches = new Map<string, WorkItem[]>();
  private readonly pendingRoots = new Set<ParentNode>();
  private readonly dirtyRecordIds = new Set<string>();
  private readonly deferredWork: WorkItem[] = [];
  private readonly externalSourceValues = new Map<Text, string>();
  private expectedSourceMutations = new WeakMap<Text, string[]>();
  private queueHead = 0;
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private mutationTimer: number | null = null;
  private pumpScheduled = false;
  private enabled = false;
  private inFlight = 0;
  private generation = 0;
  private nextRecordId = 0;
  private lastError: TranslationErrorPayload | null = null;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  updateSettings(settings: ExtensionSettings): void {
    const needsRetranslation = this.settings.sourceLanguage !== settings.sourceLanguage
      || this.settings.targetLanguage !== settings.targetLanguage
      || this.settings.activeProfileId !== settings.activeProfileId;
    const modeChanged = this.settings.pageDisplayMode !== settings.pageDisplayMode;
    this.settings = settings;

    if (needsRetranslation && this.enabled) {
      this.restartTranslations();
      return;
    }
    if (modeChanged) this.applyModeToAll();
  }

  getState(): PageTranslationState {
    let translatedCount = 0;
    let pendingCount = 0;
    for (const record of this.records.values()) {
      if (record.status === 'translated') translatedCount += 1;
      else pendingCount += 1;
    }
    return {
      enabled: this.enabled,
      mode: this.settings.pageDisplayMode,
      sourceLanguage: this.settings.sourceLanguage,
      targetLanguage: this.settings.targetLanguage,
      translatedCount,
      pendingCount,
      error: this.lastError,
    };
  }

  setEnabled(enabled: boolean): PageTranslationState {
    if (enabled === this.enabled) return this.getState();
    if (enabled) this.start();
    else this.stop();
    return this.getState();
  }

  setMode(mode: PageDisplayMode): PageTranslationState {
    this.settings = { ...this.settings, pageDisplayMode: mode };
    this.applyModeToAll();
    return this.getState();
  }

  destroy(): void {
    this.stop();
  }

  private start(): void {
    if (this.enabled || !document.body) return;
    this.enabled = true;
    this.generation += 1;
    this.lastError = null;
    document.documentElement.dataset.niraPageState = this.settings.pageDisplayMode;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => viewportDistance(left.boundingClientRect) - viewportDistance(right.boundingClientRect));
        for (const entry of visible) {
          for (const id of this.intersectionRecords.get(entry.target) ?? []) {
            const record = this.records.get(id);
            if (record) this.enqueueRecord(record);
          }
        }
      },
      { rootMargin: '800px 0px', threshold: 0.01 },
    );

    this.mutationObserver = new MutationObserver((mutations) => this.queueMutations(mutations));
    this.observeMutationRoot(document.documentElement);
    this.scan(document.body);
    this.pruneDetachedRecords();
  }

  private stop(): void {
    if (!this.enabled && this.records.size === 0) return;
    this.enabled = false;
    this.generation += 1;
    document.documentElement.removeAttribute('data-nira-page-state');
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.observedMutationRoots = new WeakSet<Node>();
    this.expectedSourceMutations = new WeakMap<Text, string[]>();
    if (this.mutationTimer !== null) window.clearTimeout(this.mutationTimer);
    this.mutationTimer = null;
    this.cancelActiveWork();
    this.pendingRoots.clear();
    this.dirtyRecordIds.clear();
    this.externalSourceValues.clear();

    for (const record of [...this.records.values()]) this.removeRecord(record);
    this.records.clear();
    this.ancestorRecords.clear();
    this.intersectionRecords.clear();
    this.nextRecordId = 0;
    this.lastError = null;
  }

  private restartTranslations(): void {
    this.generation += 1;
    this.lastError = null;
    this.cancelActiveWork();
    const candidates: ParagraphRecord[] = [];
    for (const record of this.records.values()) {
      this.removeRendered(record);
      record.status = 'observed';
      record.translatedText = null;
      record.fragments = [];
      record.fragmentJoiners = [];
      record.translatedFragments = [];
      record.preserveStructure = true;
      record.generation = this.generation;
      candidates.push(record);
    }
    const nearViewport = candidates.filter((record) => isNearViewport(record.paragraph.commonAncestor));
    for (const record of nearViewport) this.enqueueRecord(record);
  }

  private cancelActiveWork(): void {
    for (const jobId of this.activeJobs) void cancelTranslation(jobId);
    this.activeJobs.clear();
    this.activeBatches.clear();
    this.queue.length = 0;
    this.queueHead = 0;
    this.deferredWork.length = 0;
    this.queuedIds.clear();
    this.inFlight = 0;
    this.pumpScheduled = false;
  }

  private scan(root: ParentNode): void {
    if (!this.enabled || isNiraTranslationNode(root as Node)) return;
    const paragraphs = parsePageParagraphs(root);
    const discovered: ParagraphRecord[] = [];
    for (const paragraph of paragraphs) {
      if (!paragraph.commonAncestor.isConnected || this.findExistingRecord(paragraph)) continue;
      const ordinal = ++this.nextRecordId;
      const record: ParagraphRecord = {
        id: `paragraph-${ordinal}`,
        segmentId: `page-${paragraph.key}-${ordinal}`,
        paragraph,
        status: 'observed',
        rendered: null,
        translatedText: null,
        fragments: [],
        fragmentJoiners: [],
        translatedFragments: [],
        preserveStructure: true,
        generation: this.generation,
      };
      this.records.set(record.id, record);
      this.indexRecord(record);
      this.observeRecord(record);
      discovered.push(record);
    }
    const nearViewport = discovered.filter((record) => isNearViewport(record.paragraph.commonAncestor));
    for (const record of nearViewport) this.enqueueRecord(record);
    this.discoverShadowRoots(root);
  }

  private findExistingRecord(paragraph: ParsedParagraph): ParagraphRecord | null {
    const first = paragraph.rootNodes[0];
    const last = paragraph.rootNodes.at(-1);
    if (!first || !last) return null;
    const indexed = this.sourceIndex.get(first);
    if (indexed && this.records.get(indexed.id) === indexed
      && indexed.paragraph.commonAncestor === paragraph.commonAncestor
      && indexed.paragraph.rootNodes.at(-1) === last) return indexed;
    for (const id of this.ancestorRecords.get(paragraph.commonAncestor) ?? []) {
      const record = this.records.get(id);
      if (record?.paragraph.rootNodes[0] === first && record.paragraph.rootNodes.at(-1) === last) return record;
    }
    return null;
  }

  private indexRecord(record: ParagraphRecord): void {
    const { paragraph } = record;
    for (const node of [...paragraph.rootNodes, ...paragraph.flatNodes, ...paragraph.sourceTextNodes]) {
      this.sourceIndex.set(node, record);
    }
    const ids = this.ancestorRecords.get(paragraph.commonAncestor) ?? new Set<string>();
    ids.add(record.id);
    this.ancestorRecords.set(paragraph.commonAncestor, ids);
    paragraph.commonAncestor.setAttribute('data-nira-paragraph', '');
  }

  private observeRecord(record: ParagraphRecord): void {
    const target = record.paragraph.commonAncestor;
    const ids = this.intersectionRecords.get(target) ?? new Set<string>();
    if (ids.size === 0) this.intersectionObserver?.observe(target);
    ids.add(record.id);
    this.intersectionRecords.set(target, ids);
  }

  private observeMutationRoot(root: Node): boolean {
    if (!this.mutationObserver || this.observedMutationRoots.has(root)) return false;
    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    });
    this.observedMutationRoots.add(root);
    return true;
  }

  private discoverShadowRoots(root: ParentNode): void {
    const elements: Element[] = [];
    if (root instanceof Element) elements.push(root);
    elements.push(...root.querySelectorAll('*'));
    for (const element of elements) {
      if (!element.shadowRoot || element.shadowRoot.mode !== 'open') continue;
      this.observeMutationRoot(element.shadowRoot);
      if (!element.shadowRoot.querySelector('[data-nira-paragraph]')) this.scan(element.shadowRoot);
    }
  }

  private enqueueRecord(record: ParagraphRecord): void {
    if (!this.enabled || record.status !== 'observed' || !this.isCurrentRecord(record)) return;
    const plan = createPageFragmentPlan(
      record.paragraph.serializedText,
      record.paragraph.sourceText,
      record.paragraph.tokens,
      MAX_BATCH_CHARACTERS,
    );
    record.fragments = plan.fragments;
    record.fragmentJoiners = plan.joiners;
    record.preserveStructure = plan.preserveStructure;
    record.translatedFragments = new Array<string>(record.fragments.length);
    this.enqueueFragment(record, 0, 0);
    this.renderLoading(record);
    this.schedulePump();
  }

  private enqueueFragment(record: ParagraphRecord, fragmentIndex: number, attempt: number): void {
    const text = record.fragments[fragmentIndex];
    if (text === undefined) return;
    const id = fragmentSegmentId(record, fragmentIndex);
    if (this.queuedIds.has(id)) return;
    record.status = 'queued';
    this.queuedIds.add(id);
    this.queue.push({
      record,
      segment: { id, text },
      fragmentIndex,
      attempt,
    });
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    while (this.enabled && this.inFlight < MAX_CONCURRENCY && this.queueHead < this.queue.length) {
      const batch = this.takeBatch();
      if (batch.length === 0) return;
      this.inFlight += 1;
      void this.translateBatch(batch);
    }
  }

  private takeBatch(): WorkItem[] {
    const batch: WorkItem[] = [];
    let characters = 0;
    while (this.queueHead < this.queue.length && batch.length < MAX_BATCH_SEGMENTS) {
      const next = this.queue[this.queueHead];
      if (!next) break;
      if (batch.length > 0 && next.attempt > 0) break;
      const nextLength = next.segment.text.length;
      if (nextLength > MAX_BATCH_CHARACTERS) {
        this.queueHead += 1;
        this.queuedIds.delete(next.segment.id);
        if (this.isCurrentRecord(next.record)) {
          next.record.status = 'observed';
          this.removeRendered(next.record);
          this.lastError = {
            code: 'INVALID_PROFILE',
            message: '页面段落拆分失败，请重试页面翻译',
            retryable: true,
          };
        }
        continue;
      }
      if (batch.length > 0 && characters + nextLength > MAX_BATCH_CHARACTERS) break;
      this.queueHead += 1;
      this.queuedIds.delete(next.segment.id);
      if (!this.isCurrentRecord(next.record)) continue;
      batch.push(next);
      characters += nextLength;
      next.record.status = 'translating';
      if (next.attempt > 0) break;
    }
    this.compactConsumedQueue();
    return batch;
  }

  private compactConsumedQueue(): void {
    if (this.queueHead < 1_024 || this.queueHead * 2 < this.queue.length) return;
    this.queue.splice(0, this.queueHead);
    this.queueHead = 0;
  }

  private async translateBatch(batch: WorkItem[]): Promise<void> {
    const requestGeneration = this.generation;
    const jobId = createJobId('page');
    this.activeJobs.add(jobId);
    this.activeBatches.set(jobId, batch);
    try {
      const request = {
        jobId,
        kind: 'page' as const,
        sourceLanguage: this.settings.sourceLanguage,
        targetLanguage: this.settings.targetLanguage,
        segments: batch.map((item) => item.segment),
        ...(this.settings.activeProfileId ? { profileId: this.settings.activeProfileId } : {}),
      };
      const result = await requestTranslation(request);
      if (!this.enabled || requestGeneration !== this.generation || !this.activeJobs.has(jobId)) return;
      const byId = new Map(result.translations.map((segment) => [segment.id, segment.text]));
      let hasMissing = false;
      for (const item of batch) {
        if (!this.isCurrentRecord(item.record)) continue;
        const translated = byId.get(item.segment.id);
        if (!translated?.trim()) {
          hasMissing = true;
          this.retryMissingSegment(item);
          continue;
        }
        item.record.translatedFragments[item.fragmentIndex] = translated;
        const nextFragmentIndex = item.fragmentIndex + 1;
        if (nextFragmentIndex < item.record.fragments.length) {
          this.enqueueFragment(item.record, nextFragmentIndex, 0);
          continue;
        }
        const combined = joinTranslatedFragments(
          item.record.translatedFragments,
          item.record.fragmentJoiners,
        );
        item.record.status = 'translated';
        if (isUnchangedTranslation(item.record.paragraph, combined)) {
          item.record.translatedText = null;
          this.removeRendered(item.record);
          continue;
        }
        item.record.translatedText = combined;
        this.renderTranslation(item.record, combined);
      }
      if (!hasMissing) this.lastError = null;
    } catch (error) {
      if (!this.enabled || requestGeneration !== this.generation || !this.activeJobs.has(jobId)) return;
      const runtimeError = error as RuntimeError;
      this.lastError = runtimeError.payload ?? {
        code: 'NETWORK_ERROR',
        message: runtimeError.message || '页面翻译失败',
        retryable: true,
      };
      for (const item of batch) {
        if (!this.isCurrentRecord(item.record)) continue;
        if (this.lastError.retryable && item.attempt < MAX_MISSING_SEGMENT_RETRIES) {
          this.enqueueFragment(item.record, item.fragmentIndex, item.attempt + 1);
          continue;
        }
        item.record.status = 'observed';
        item.record.fragments = [];
        item.record.fragmentJoiners = [];
        item.record.translatedFragments = [];
        this.removeRendered(item.record);
      }
    } finally {
      this.activeBatches.delete(jobId);
      const released = this.activeJobs.delete(jobId);
      if (released && requestGeneration === this.generation) {
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.pump();
      }
    }
  }

  private renderLoading(record: ParagraphRecord): void {
    if (!this.isCurrentRecord(record) || record.rendered) return;
    record.rendered = insertParagraphTranslation(
      record.paragraph,
      '正在翻译',
      this.settings.targetLanguage,
      'loading',
    );
    this.translationIndex.set(record.rendered.outer, record);
    this.translationIndex.set(record.rendered.inner, record);
  }

  private renderTranslation(record: ParagraphRecord, translated: string): void {
    if (!this.isCurrentRecord(record)) return;
    if (record.rendered) {
      updateParagraphTranslation(
        record.rendered,
        record.paragraph,
        translated,
        this.settings.targetLanguage,
        record.preserveStructure,
      );
    } else {
      record.rendered = insertParagraphTranslation(
        record.paragraph,
        translated,
        this.settings.targetLanguage,
        'done',
        record.preserveStructure,
      );
      this.translationIndex.set(record.rendered.outer, record);
      this.translationIndex.set(record.rendered.inner, record);
    }
    this.applyRecordMode(record, this.settings.pageDisplayMode);
  }

  private retryMissingSegment(item: WorkItem): void {
    const record = item.record;
    if (!this.isCurrentRecord(record)) return;
    if (item.attempt >= MAX_MISSING_SEGMENT_RETRIES) {
      record.status = 'observed';
      this.removeRendered(record);
      this.lastError = {
        code: 'INVALID_RESPONSE',
        message: '翻译服务遗漏了部分段落，请重试页面翻译',
        retryable: true,
      };
      return;
    }
    record.status = 'queued';
    this.queuedIds.add(item.segment.id);
    this.queue.push({ ...item, attempt: item.attempt + 1 });
    this.schedulePump();
  }

  private applyModeToAll(): void {
    document.documentElement.dataset.niraPageState = this.settings.pageDisplayMode;
    for (const record of this.records.values()) {
      if (record.rendered && record.status === 'translated') {
        this.applyRecordMode(record, this.settings.pageDisplayMode);
      }
    }
  }

  private applyRecordMode(record: ParagraphRecord, mode: PageDisplayMode): void {
    if (!record.rendered) return;
    if (mode === 'translation' && !record.rendered.sourceSuppressed) {
      this.expectSourceWrites(record, 'suppress');
    } else if (mode === 'dual' && record.rendered.sourceSuppressed) {
      this.expectSourceWrites(record, 'restore');
    }
    setParagraphDisplayMode(record.rendered, record.paragraph, mode);
  }

  private queueMutations(mutations: MutationRecord[]): void {
    if (!this.enabled) return;
    let hasWork = false;
    for (const mutation of mutations) {
      let queuedAddedRoot = false;
      if (mutation.type === 'childList') this.repairRemovedTranslation(mutation.removedNodes);
      if (isNiraTranslationNode(mutation.target)) continue;
      if (mutation.type === 'childList' && changedNodesAreInternal(mutation)) continue;

      const target = mutation.target;
      if (mutation.type === 'characterData'
        && this.isExpectedSourceMutation(target, mutation.oldValue)) continue;
      const directRecord = this.findRecordForNode(target);
      if (mutation.type === 'characterData' && target instanceof Text && directRecord) {
        this.externalSourceValues.set(target, target.data);
        if (directRecord.rendered?.sourceSuppressed) {
          directRecord.rendered.sourceSnapshot.set(target, target.data);
        }
      }

      const affected = this.findAffectedRecords(target);
      if (directRecord) affected.add(directRecord);
      if (mutation.type === 'childList') {
        for (const record of this.findRemovedRecords(mutation.removedNodes)) affected.add(record);
      }
      for (const record of affected) this.dirtyRecordIds.add(record.id);
      this.cancelJobsForRecords(affected);
      if (affected.size > 0) hasWork = true;

      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (isNiraTranslationNode(node)) continue;
          const root = nearestParseRoot(node);
          if (root) {
            this.pendingRoots.add(root);
            queuedAddedRoot = true;
            hasWork = true;
          }
        }
      }

      if (affected.size === 0 && !queuedAddedRoot) {
        const root = nearestParseRoot(target);
        if (root) {
          this.pendingRoots.add(root);
          hasWork = true;
        }
      }
    }
    if (hasWork) this.scheduleMutationFlush();
  }

  private scheduleMutationFlush(): void {
    if (this.mutationTimer !== null) return;
    this.mutationTimer = window.setTimeout(() => this.flushMutations(), MUTATION_CONSUME_MS);
  }

  private cancelJobsForRecords(records: Set<ParagraphRecord>): void {
    if (records.size === 0) return;
    const staleIds = new Set([...records].map((record) => record.id));
    for (const [jobId, batch] of [...this.activeBatches]) {
      if (!batch.some((item) => staleIds.has(item.record.id))) continue;
      this.activeBatches.delete(jobId);
      if (!this.activeJobs.delete(jobId)) continue;
      void cancelTranslation(jobId);
      this.inFlight = Math.max(0, this.inFlight - 1);
      for (const item of batch) {
        if (staleIds.has(item.record.id) || !this.isCurrentRecord(item.record)) continue;
        item.record.status = 'observed';
        this.deferredWork.push(item);
      }
    }
  }

  private flushMutations(): void {
    this.mutationTimer = null;
    if (!this.enabled) return;
    const roots = new Set<ParentNode>(this.pendingRoots);
    this.pendingRoots.clear();
    for (const id of this.dirtyRecordIds) {
      const record = this.records.get(id);
      if (!record) continue;
      const ancestor = record.paragraph.commonAncestor;
      if (ancestor.isConnected) roots.add(ancestor);
      this.captureExternalSourceChanges(record);
      this.removeRecord(record);
    }
    this.dirtyRecordIds.clear();
    for (const root of compactRoots(roots)) {
      if ((root as Node).isConnected !== false) this.scan(root);
    }
    const deferred = this.deferredWork.splice(0);
    for (const item of deferred) {
      if (!this.isCurrentRecord(item.record) || item.record.status !== 'observed') continue;
      this.enqueueFragment(item.record, item.fragmentIndex, item.attempt);
    }
    if (deferred.length > 0) this.schedulePump();
    this.pruneDetachedRecords();
  }

  private findRecordForNode(node: Node): ParagraphRecord | null {
    let current: Node | null = node;
    while (current) {
      const direct = this.sourceIndex.get(current);
      if (direct && this.isCurrentRecord(direct)) return direct;
      current = current.parentNode instanceof ShadowRoot
        ? current.parentNode.host
        : current.parentNode;
    }
    return null;
  }

  private findAffectedRecords(node: Node): Set<ParagraphRecord> {
    const affected = new Set<ParagraphRecord>();
    if (node.nodeType !== Node.ELEMENT_NODE) return affected;
    for (const id of this.ancestorRecords.get(node as HTMLElement) ?? []) {
      const record = this.records.get(id);
      if (record) affected.add(record);
    }
    return affected;
  }

  private findRemovedRecords(nodes: NodeList): Set<ParagraphRecord> {
    const removed = new Set<ParagraphRecord>();
    for (const node of nodes) {
      const direct = this.sourceIndex.get(node);
      if (direct && this.records.get(direct.id) === direct) removed.add(direct);
      if (!(node instanceof Element)) continue;
      for (const element of [node, ...node.querySelectorAll<HTMLElement>('[data-nira-paragraph]')]) {
        if (!(element instanceof HTMLElement)) continue;
        for (const id of this.ancestorRecords.get(element) ?? []) {
          const record = this.records.get(id);
          if (record) removed.add(record);
        }
      }
    }
    return removed;
  }

  private isExpectedSourceMutation(node: Node, oldValue: string | null): boolean {
    if (!(node instanceof Text) || oldValue === null) return false;
    const expected = this.expectedSourceMutations.get(node);
    if (!expected || expected[0] !== oldValue) return false;
    expected.shift();
    if (expected.length === 0) this.expectedSourceMutations.delete(node);
    return true;
  }

  private expectSourceWrites(record: ParagraphRecord, operation: 'suppress' | 'restore'): void {
    const rendered = record.rendered;
    if (!rendered) return;
    for (const node of record.paragraph.sourceTextNodes) {
      const next = operation === 'suppress' ? '' : rendered.sourceSnapshot.get(node);
      if (next === undefined || next === node.data) continue;
      const expected = this.expectedSourceMutations.get(node) ?? [];
      expected.push(node.data);
      this.expectedSourceMutations.set(node, expected);
    }
  }

  private captureExternalSourceChanges(record: ParagraphRecord): void {
    const rendered = record.rendered;
    if (!rendered?.sourceSuppressed) return;
    for (const node of record.paragraph.sourceTextNodes) {
      if (this.externalSourceValues.has(node)) {
        rendered.sourceSnapshot.set(node, this.externalSourceValues.get(node) ?? '');
        this.externalSourceValues.delete(node);
      } else if (node.data !== '') {
        rendered.sourceSnapshot.set(node, node.data);
      }
    }
  }

  private repairRemovedTranslation(nodes: NodeList): void {
    for (const node of nodes) {
      const record = this.translationIndex.get(node);
      if (!record || (record.rendered?.outer !== node && record.rendered?.inner !== node)
        || this.records.get(record.id) !== record || !record.paragraph.commonAncestor.isConnected) continue;
      this.translationIndex.delete(record.rendered.outer);
      this.translationIndex.delete(record.rendered.inner);
      if (record.rendered.sourceSuppressed) this.expectSourceWrites(record, 'restore');
      removeParagraphTranslation(record.rendered, record.paragraph);
      record.rendered = null;
      if (record.status !== 'translated' || !record.translatedText) continue;
      queueMicrotask(() => {
        if (this.isCurrentRecord(record) && !record.rendered && record.translatedText) {
          this.renderTranslation(record, record.translatedText);
        }
      });
    }
  }

  private removeRendered(record: ParagraphRecord): void {
    if (!record.rendered) return;
    this.translationIndex.delete(record.rendered.outer);
    this.translationIndex.delete(record.rendered.inner);
    if (record.rendered.sourceSuppressed) this.expectSourceWrites(record, 'restore');
    removeParagraphTranslation(record.rendered, record.paragraph);
    record.rendered = null;
  }

  private removeRecord(record: ParagraphRecord): void {
    if (this.records.get(record.id) !== record) return;
    this.records.delete(record.id);
    for (const node of [
      ...record.paragraph.rootNodes,
      ...record.paragraph.flatNodes,
      ...record.paragraph.sourceTextNodes,
    ]) {
      if (this.sourceIndex.get(node) === record) this.sourceIndex.delete(node);
      if (node instanceof Text) this.externalSourceValues.delete(node);
    }
    for (let index = 0; index < record.fragments.length; index += 1) {
      this.queuedIds.delete(fragmentSegmentId(record, index));
    }
    const ancestor = record.paragraph.commonAncestor;
    const ancestorIds = this.ancestorRecords.get(ancestor);
    ancestorIds?.delete(record.id);
    if (ancestorIds?.size === 0) {
      this.ancestorRecords.delete(ancestor);
      ancestor.removeAttribute('data-nira-paragraph');
    }
    const intersectionIds = this.intersectionRecords.get(ancestor);
    intersectionIds?.delete(record.id);
    if (intersectionIds?.size === 0) {
      this.intersectionRecords.delete(ancestor);
      this.intersectionObserver?.unobserve(ancestor);
    }
    this.removeRendered(record);
  }

  private pruneDetachedRecords(): void {
    for (const record of [...this.records.values()]) {
      if (!record.paragraph.commonAncestor.isConnected) this.removeRecord(record);
    }
  }

  private isCurrentRecord(record: ParagraphRecord): boolean {
    return this.enabled
      && record.generation === this.generation
      && !this.dirtyRecordIds.has(record.id)
      && record.paragraph.commonAncestor.isConnected
      && this.records.get(record.id) === record;
  }
}

function changedNodesAreInternal(mutation: MutationRecord): boolean {
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.length > 0 && nodes.every((node) => isNiraTranslationNode(node));
}

function nearestParseRoot(node: Node): ParentNode | null {
  let element = node instanceof Element ? node : node.parentElement;
  if (!element) return null;
  if (isNiraTranslationNode(element)) return null;
  if (element instanceof HTMLElement && isPageBlockElement(element)) return element;
  while (element.parentElement && element !== document.body) {
    element = element.parentElement;
    if (element instanceof HTMLElement && isPageBlockElement(element)) return element;
  }
  return element;
}

function compactRoots(roots: Set<ParentNode>): ParentNode[] {
  const connected = new Set(
    [...roots].filter((root): root is ParentNode & Node => root instanceof Node && root.isConnected !== false),
  );
  return [...connected].filter((root) => {
    let parent = composedParent(root);
    while (parent) {
      if (connected.has(parent as ParentNode & Node)) return false;
      parent = composedParent(parent);
    }
    return true;
  });
}

function composedParent(node: Node): Node | null {
  if (node instanceof ShadowRoot) return node.host;
  if (node.parentNode instanceof ShadowRoot) return node.parentNode.host;
  return node.parentNode;
}

function isNearViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom >= -800 && rect.top <= window.innerHeight + 800;
}

function viewportDistance(rect: DOMRectReadOnly): number {
  if (rect.bottom >= 0 && rect.top <= window.innerHeight) return 0;
  return rect.top > window.innerHeight ? rect.top - window.innerHeight : Math.abs(rect.bottom);
}

function fragmentSegmentId(record: ParagraphRecord, fragmentIndex: number): string {
  if (record.fragments.length <= 1) return record.segmentId;
  return `${record.segmentId}-part-${fragmentIndex + 1}-of-${record.fragments.length}`;
}

function joinTranslatedFragments(fragments: string[], joiners: string[]): string {
  let combined = fragments[0] ?? '';
  for (let index = 1; index < fragments.length; index += 1) {
    const next = fragments[index] ?? '';
    const joiner = joiners[index - 1] ?? '';
    combined += `${joiner}${next}`;
  }
  return combined;
}

function isUnchangedTranslation(paragraph: ParsedParagraph, translated: string): boolean {
  if (normalizeComparableText(translated) === normalizeComparableText(paragraph.serializedText)) return true;
  let decoded = translated;
  for (const [key, token] of paragraph.tokens) {
    decoded = decoded.split(key).join(token.kind === 'break' ? '\n' : '');
  }
  return normalizeComparableText(decoded) === normalizeComparableText(paragraph.sourceText);
}

function normalizeComparableText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
