import React, {useEffect, useId, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Button, Icon, Message, Menu, Form, TextArea} from 'semantic-ui-react';

let rowSeq = 0;
const nextRowId = () => `mm_${Date.now()}_${rowSeq++}`;

function getDuplicateSources(rows) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const source = (row.from || '').trim();
    if (!source) continue;
    if (seen.has(source)) {
      duplicates.add(source);
    } else {
      seen.add(source);
    }
  }
  return Array.from(duplicates);
}

function parseJsonToRows(json) {
  try {
    if (!json || !String(json).trim()) return [];
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.entries(parsed).map(([from, to]) => ({
      id: nextRowId(),
      from,
      to: String(to),
    }));
  } catch {
    return null;
  }
}

function rowsToJson(rows) {
  const obj = {};
  rows.forEach((row) => {
    const from = (row.from || '').trim();
    if (from) obj[from] = (row.to || '').trim();
  });
  return Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : '';
}

const TEMPLATE = {
  'gpt-3.5-turbo-0301': 'gpt-3.5-turbo',
  'gpt-4-0314': 'gpt-4',
  'gpt-4-32k-0314': 'gpt-4-32k',
};

export default function ModelMappingEditor({value, onChange, modelOptions = [], disabled = false}) {
  const {t} = useTranslation();
  const sourceListId = useId();
  const targetListId = useId();
  const [mode, setMode] = useState('visual');
  const [rows, setRows] = useState([]);
  const [jsonValue, setJsonValue] = useState(value || '');
  const [error, setError] = useState(null);

  useEffect(() => {
    setJsonValue(value || '');
    const parsed = parseJsonToRows(value);
    if (parsed) setRows(parsed);
  }, [value]);

  const duplicateSources = useMemo(() => getDuplicateSources(rows), [rows]);

  const syncRows = (nextRows) => {
    setRows(nextRows);
    const duplicates = getDuplicateSources(nextRows);
    if (duplicates.length > 0) {
      setError(t('channel.edit.model_mapping_duplicate', {models: duplicates.join(', ')}));
      return;
    }
    setError(null);
    const json = rowsToJson(nextRows);
    setJsonValue(json);
    onChange(json);
  };

  const handleAddRow = () => {
    syncRows([...rows, {id: nextRowId(), from: '', to: ''}]);
  };

  const handleDeleteRow = (id) => {
    syncRows(rows.filter((row) => row.id !== id));
  };

  const handleRowChange = (id, field, newValue) => {
    const updated = rows.map((row) => (row.id === id ? {...row, [field]: newValue} : row));
    syncRows(updated);
  };

  const handleJsonChange = (e) => {
    const newJson = e.target.value;
    setJsonValue(newJson);
    onChange(newJson);
    const parsed = parseJsonToRows(newJson);
    setError(parsed ? null : t('channel.edit.messages.model_mapping_invalid'));
  };

  const handleFillTemplate = () => {
    const json = JSON.stringify(TEMPLATE, null, 2);
    setJsonValue(json);
    onChange(json);
    const parsed = parseJsonToRows(json);
    if (parsed) setRows(parsed);
    setError(null);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'json') {
      const duplicates = getDuplicateSources(rows);
      if (duplicates.length === 0) {
        const json = rowsToJson(rows);
        setJsonValue(json);
        onChange(json);
      }
      setMode('json');
      return;
    }
    const parsed = parseJsonToRows(jsonValue);
    if (parsed) setRows(parsed);
    setError(parsed ? null : t('channel.edit.messages.model_mapping_invalid'));
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
          {rows.length > 0 ? (
            <div style={{marginBottom: '0.6em'}}>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: '0.5em', fontWeight: 600, fontSize: '0.9em', marginBottom: '0.3em'}}>
                <div>{t('channel.edit.mapping_from')}</div>
                <div>{t('channel.edit.mapping_to')}</div>
                <div />
              </div>
              {rows.map((row) => (
                <div key={row.id} style={{display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: '0.5em', marginBottom: '0.4em'}}>
                  <Form.Input
                    value={row.from}
                    list={sourceListId}
                    placeholder='gpt-3.5-turbo'
                    disabled={disabled}
                    onChange={(e) => handleRowChange(row.id, 'from', e.target.value)}
                  />
                  <Form.Input
                    value={row.to}
                    list={targetListId}
                    placeholder='gpt-3.5-turbo-0125'
                    disabled={disabled}
                    onChange={(e) => handleRowChange(row.id, 'to', e.target.value)}
                  />
                  <Button
                    type='button'
                    icon='trash'
                    basic
                    color='red'
                    style={{height: '2.7em'}}
                    disabled={disabled}
                    onClick={() => handleDeleteRow(row.id)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div style={{textAlign: 'center', color: '#999', padding: '1.5em 0', border: '1px dashed #ccc', borderRadius: '4px', marginBottom: '0.6em'}}>
              {t('channel.edit.mapping_empty')}
            </div>
          )}
          <Button type='button' icon basic size='small' onClick={handleAddRow} disabled={disabled}>
            <Icon name='plus' /> {t('channel.edit.mapping_add')}
          </Button>
        </div>
      )}

      {mode === 'json' && (
        <TextArea
          value={jsonValue}
          onChange={handleJsonChange}
          placeholder={'{"gpt-3.5-turbo-0301": "gpt-3.5-turbo"}'}
          disabled={disabled}
          style={{
            minHeight: 180,
            fontFamily: 'JetBrains Mono, Consolas',
            borderColor: error ? '#e0b4b4' : undefined,
          }}
        />
      )}

      <datalist id={sourceListId}>
        {modelOptions.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <datalist id={targetListId}>
        {modelOptions.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
    </div>
  );
}