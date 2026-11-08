'use strict';

function effortValue(option) {
  if (typeof option === 'string') return option;
  return option?.reasoningEffort || option?.effort || null;
}

function normalizeModels(pages) {
  const models = [];
  const seen = new Set();
  for (const page of pages) {
    for (const entry of page?.data || []) {
      const id = typeof entry?.id === 'string' && entry.id.trim()
        ? entry.id.trim()
        : typeof entry?.model === 'string' ? entry.model.trim() : '';
      if (!id || entry.hidden === true || seen.has(id)) continue;
      const efforts = (entry.supportedReasoningEfforts || []).map(effortValue).filter(Boolean);
      const defaultEffort = effortValue(entry.defaultReasoningEffort);
      if (defaultEffort && !efforts.includes(defaultEffort)) efforts.push(defaultEffort);
      if (efforts.length === 0) continue;
      seen.add(id);
      models.push({
        id,
        model: typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : id,
        displayName: typeof entry.displayName === 'string' && entry.displayName.trim() ? entry.displayName : id,
        description: typeof entry.description === 'string' ? entry.description : '',
        isDefault: entry.isDefault === true,
        defaultEffort: defaultEffort || efforts[0],
        efforts,
        inputModalities: Array.isArray(entry.inputModalities) ? [...entry.inputModalities] : ['text', 'image']
      });
    }
  }
  return models;
}

function selectModel(models, modelId, effort) {
  const model = models.find(entry => entry.id === modelId || entry.model === modelId);
  if (!model) throw new Error('Unsupported model');
  if (!model.efforts.includes(effort)) throw new Error('Unsupported reasoning effort');
  return model;
}

module.exports = {normalizeModels, selectModel};
