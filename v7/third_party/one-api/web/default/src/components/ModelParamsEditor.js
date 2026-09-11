import React, {useEffect, useId, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Button, Icon, Menu, Message, Form, TextArea} from 'semantic-ui-react';

let seq = 0;
const nextId = () => `mp_${Date.now()}_${seq++}`;

function toValueText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseLooseValue(valueText) {
  const raw = String(valueText ?? '').trim();
  if (raw === '') return '';
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseJsonToModels(json) {
  try {
    if (!json || !String(json).trim()) return [];
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.entries(parsed).map(([model, params]) => ({
      id: nextId(),
      model,
      params:
        params && typeof params === 'object' && !Array.isArray(params)
          ? Object.entries(params).map(([key, value]) => ({
              id: nextId(),
              key,
              value: toValueText(value),
            }))
          : [],
    }));
  } catch {
    return null;
  }
}

function modelsToJson(models) {
  const obj = {};
  models.forEach((m) => {
    const model = m.model.trim();
    if (!model) return;
    const params = {};
    m.params.forEach((p) => {
      const key = p.key.trim();
      if (key) params[key] = parseLooseValue(p.value);
    });
    if (Object.keys(params).length > 0) obj[model] = params;
  });
  return Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : '';
}

const TEMPLATE = {
  auto: {max_tokens: 8192, temperature: 0.7},
  'Qwen3.8-27B': {max_tokens: 4096, temperature: 0.5},
};

export default function ModelParamsEditor({value, onChange, modelOptions = [], disabled = false}) {
  const {t} = useTranslation();
  const modelListId = useId();
  const [mode, setMode] = useState('visual');
  const [models, setModels] = useState([]);
  const [jsonValue, setJsonValue] = useState(value || '');
  const [error, setError] = useState(null);

  useEffect(() => {
    setJsonValue(value || '');
    const parsed = parseJsonToModels(value);
    if (parsed) setModels(parsed);
  }, [value]);

  const syncModels = (nextModels) => {
    setModels(nextModels);
    setError(null);
    const json = modelsToJson(nextModels);
    setJsonValue(json);
    onChange(json);
  };

  const handleAddModel = () => {
    syncModels([...models, {id: nextId(), model: '', params: []}]);
  };

  const handleDeleteModel = (id) => {
    syncModels(models.filter((m) => m.id !== id));
  };

  const handleModelChange = (id, model) => {
    syncModels(models.map((m) => (m.id === id ? {...m, model} : m)));
  };

  const handleAddParam = (modelId) => {
    syncModels(
      models.map((m) =>
        m.id === modelId ? {...m, params: [...m.params, {id: nextId(), key: '', value: ''}]} : m
      )
    );
  };

  const handleDeleteParam = (modelId, paramId) => {
    syncModels(
      models.map((m) =>
        m.id === modelId ? {...m, params: m.params.filter((p) => p.id !== paramId)} : m
      )
    );
  };

  const handleParamChange = (modelId, paramId, field, newValue) => {
    syncModels(
      models.map((m) =>
        m.id === modelId
          ? {...m, params: m.params.map((p) => (p.id === paramId ? {...p, [field]: newValue} : p))}
          : m
      )
    );
  };

  const handleJsonChange = (e) => {
    const newJson = e.target.value;
    setJsonValue(newJson);
    onChange(newJson);
    const parsed = parseJsonToModels(newJson);
    setError(parsed ? null : t('channel.edit.messages.model_params_invalid'));
  };

  const handleFillTemplate = () => {
    const json = JSON.stringify(TEMPLATE, null, 2);
    setJsonValue(json);
    onChange(json);
    const parsed = parseJsonToModels(json);
    if (parsed) setModels(parsed);
    setError(null);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'json') {
      const json = modelsToJson(models);
      setJsonValue(json);
      onChange(json);
      setMode('json');
      return;
    }
    const parsed = parseJsonToModels(jsonValue);
    if (parsed) setModels(parsed);
    setError(parsed ? null : t('channel.edit.messages.model_params_invalid'));
    setMode('visual');
  };

  return (
    <div>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5em'}}>
        <Menu tabular size='small' style={{marginBottom: 0, minHeight: 0}}>
          <Menu.Item
            active={mode === 'visual'}
            onClick={() => handleModeChange('visual')}
            style={{padding: '0.4em 0.8em'}}
          >
            <Icon name='table' /> {t('channel.edit.mapping_tab_visual')}
          </Menu.Item>
          <Menu.Item
            active={mode === 'json'}
            onClick={() => handleModeChange('json')}
            style={{padding: '0.4em 0.8em'}}
          >
            <Icon name='code' /> {t('channel.edit.mapping_tab_json')}
          </Menu.Item>
        </Menu>
        <Button basic size='small' type='button' onClick={handleFillTemplate} disabled={disabled}>
          {t('channel.edit.mapping_fill_template')}
        </Button>
      </div>

      {error && (
        <Message negative size='small' style={{marginBottom: '0.5em'}}>
          {error}
        </Message>
      )}

      {mode === 'visual' && (
        <div style={{border: '1px solid rgba(34,36,38,0.15)', borderRadius: '0.28571429rem', padding: '0.8em'}}>
          {models.length > 0 ? (
            models.map((modelEntry) => (
              <div
                key={modelEntry.id}
                style={{border: '1px solid rgba(34,36,38,0.15)', borderRadius: '0.28571429rem', padding: '0.6em', marginBottom: '0.6em'}}
              >
                <div style={{display: 'grid', gridTemplateColumns: '1fr 36px', gap: '0.5em', marginBottom: '0.5em'}}>
                  <Form.Input
                    label={t('channel.edit.params_model')}
                    value={modelEntry.model}
                    list={modelListId}
                    placeholder='auto'
                    disabled={disabled}
                    onChange={(e) => handleModelChange(modelEntry.id, e.target.value)}
                  />
                  <Button
                    type='button'
                    icon='trash'
                    basic
                    color='red'
                    style={{marginTop: '1.6em', height: '2.7em'}}
                    disabled={disabled}
                    onClick={() => handleDeleteModel(modelEntry.id)}
                  />
                </div>
                {modelEntry.params.length > 0 && (
                  <div style={{marginBottom: '0.4em'}}>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: '0.5em', fontWeight: 600, fontSize: '0.9em', marginBottom: '0.3em'}}>
                      <div>{t('channel.edit.params_key')}</div>
                      <div>{t('channel.edit.params_value')}</div>
                      <div />
                    </div>
                    {modelEntry.params.map((param) => (
                      <div key={param.id} style={{display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: '0.5em', marginBottom: '0.4em'}}>
                        <Form.Input
                          value={param.key}
                          placeholder='max_tokens'
                          disabled={disabled}
                          onChange={(e) => handleParamChange(modelEntry.id, param.id, 'key', e.target.value)}
                        />
                        <Form.Input
                          value={param.value}
                          placeholder='8192'
                          disabled={disabled}
                          onChange={(e) => handleParamChange(modelEntry.id, param.id, 'value', e.target.value)}
                        />
                        <Button
                          type='button'
                          icon='trash'
                          basic
                          color='red'
                          style={{height: '2.7em'}}
                          disabled={disabled}
                          onClick={() => handleDeleteParam(modelEntry.id, param.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <Button type='button' basic size='small' icon disabled={disabled} onClick={() => handleAddParam(modelEntry.id)}>
                  <Icon name='plus' /> {t('channel.edit.params_add')}
                </Button>
              </div>
            ))
          ) : (
            <div style={{textAlign: 'center', color: '#999', padding: '1.5em 0', border: '1px dashed #ccc', borderRadius: '4px', marginBottom: '0.6em'}}>
              {t('channel.edit.params_empty')}
            </div>
          )}
          <Button type='button' icon basic size='small' onClick={handleAddModel} disabled={disabled}>
            <Icon name='plus' /> {t('channel.edit.params_add_model')}
          </Button>
        </div>
      )}

      {mode === 'json' && (
        <TextArea
          value={jsonValue}
          onChange={handleJsonChange}
          placeholder={'{"auto": {"max_tokens": 8192, "temperature": 0.7}}'}
          disabled={disabled}
          style={{
            minHeight: 180,
            fontFamily: 'JetBrains Mono, Consolas',
            borderColor: error ? '#e0b4b4' : undefined,
          }}
        />
      )}

      <datalist id={modelListId}>
        {modelOptions.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
    </div>
  );
}