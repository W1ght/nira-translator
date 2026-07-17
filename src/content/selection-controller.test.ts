import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../constants/defaults';
import { createSelectionTranslationRequest } from './selection-controller';

describe('createSelectionTranslationRequest', () => {
  it('uses the selection model independently from the page model', () => {
    const request = createSelectionTranslationRequest({
      ...DEFAULT_SETTINGS,
      activeProfileId: 'page-model',
      selectionProfileId: 'selection-model',
    }, 'selection-job', 'hello');

    expect(request).toMatchObject({
      jobId: 'selection-job',
      kind: 'selection',
      profileId: 'selection-model',
      segments: [{ id: 'selection-0', text: 'hello' }],
    });
    expect(request.profileId).not.toBe('page-model');
  });
});
