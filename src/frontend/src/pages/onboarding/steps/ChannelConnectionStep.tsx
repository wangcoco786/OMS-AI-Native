import { useState, useCallback, type ReactNode, type ChangeEvent } from 'react';
import { FormField } from '@/components/common';
import { StatusBadge } from '@/components/common';
import { LoadingSpinner } from '@/components/common';
import { useOnboardingStore } from '@/stores/onboarding-store';
import styles from './Steps.module.css';

type ChannelType = 'shopify' | 'wms' | 'erp' | 'custom';

interface ChannelConnectionData {
  channelType: ChannelType | '';
  apiKey: string;
  apiSecret: string;
  storeUrl: string;
}

interface ValidationErrors {
  channelType?: string;
  apiKey?: string;
  apiSecret?: string;
  storeUrl?: string;
}

const CHANNEL_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: 'shopify', label: 'Shopify' },
  { value: 'wms', label: 'WMS' },
  { value: 'erp', label: 'ERP' },
  { value: 'custom', label: '自定义' },
];

function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function validateForm(data: ChannelConnectionData): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!data.channelType) {
    errors.channelType = '请选择渠道类型';
  }
  if (!data.apiKey.trim()) {
    errors.apiKey = 'API Key 不能为空';
  }
  if (!data.apiSecret.trim()) {
    errors.apiSecret = 'API Secret 不能为空';
  }
  if (!data.storeUrl.trim()) {
    errors.storeUrl = '请输入店铺 URL';
  } else if (!validateUrl(data.storeUrl)) {
    errors.storeUrl = '请输入有效的 URL 格式';
  }

  return errors;
}

export function ChannelConnectionStep(): ReactNode {
  const { stepData, setStepData } = useOnboardingStore();
  const savedData = stepData.channel_connection.data as Partial<ChannelConnectionData> | undefined;

  const [formData, setFormData] = useState<ChannelConnectionData>({
    channelType: (savedData?.channelType as ChannelType) || '',
    apiKey: savedData?.apiKey || '',
    apiSecret: savedData?.apiSecret || '',
    storeUrl: savedData?.storeUrl || '',
  });

  const [errors, setErrors] = useState<ValidationErrors>({});
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  const handleChange = useCallback(
    (field: keyof ChannelConnectionData) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      const next = { ...formData, [field]: value };
      setFormData(next);
      setStepData('channel_connection', next as unknown as Record<string, unknown>);

      // Clear field error on change
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    [formData, errors, setStepData],
  );

  const handleTestConnection = useCallback(async () => {
    const validationErrors = validateForm(formData);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setConnectionStatus('testing');
    setConnectionMessage('');

    try {
      // Simulate API call for connection test
      const response = await fetch('/api/onboarding/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setConnectionStatus('success');
        setConnectionMessage('连接成功！渠道凭证验证通过。');
      } else {
        const body = await response.json().catch(() => ({ message: '连接失败' }));
        setConnectionStatus('failed');
        setConnectionMessage(body.message || '连接失败，请检查凭证信息。');
      }
    } catch {
      setConnectionStatus('failed');
      setConnectionMessage('网络错误，请稍后重试。');
    }
  }, [formData]);

  return (
    <div className={styles.stepContainer}>
      <h2 className={styles.stepTitle}>渠道连接</h2>
      <p className={styles.stepDescription}>
        选择渠道类型并输入 API 凭证，完成后点击"测试连接"验证配置。
      </p>

      <div className={styles.formGrid}>
        <FormField label="渠道类型" name="channelType" required error={errors.channelType}>
          <select
            id="channelType"
            className={styles.select}
            value={formData.channelType}
            onChange={handleChange('channelType')}
          >
            <option value="">请选择渠道类型</option>
            {CHANNEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="API Key" name="apiKey" required error={errors.apiKey}>
          <input
            id="apiKey"
            type="text"
            className={styles.input}
            value={formData.apiKey}
            onChange={handleChange('apiKey')}
            placeholder="输入 API Key"
          />
        </FormField>

        <FormField label="API Secret" name="apiSecret" required error={errors.apiSecret}>
          <input
            id="apiSecret"
            type="password"
            className={styles.input}
            value={formData.apiSecret}
            onChange={handleChange('apiSecret')}
            placeholder="输入 API Secret"
          />
        </FormField>

        <FormField label="店铺 URL / 端点" name="storeUrl" required error={errors.storeUrl}>
          <input
            id="storeUrl"
            type="url"
            className={styles.input}
            value={formData.storeUrl}
            onChange={handleChange('storeUrl')}
            placeholder="https://your-store.myshopify.com"
          />
        </FormField>
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.testButton}
          onClick={handleTestConnection}
          disabled={connectionStatus === 'testing'}
        >
          {connectionStatus === 'testing' ? (
            <>
              <LoadingSpinner size="sm" /> 测试中...
            </>
          ) : (
            '测试连接'
          )}
        </button>

        {connectionStatus !== 'idle' && connectionStatus !== 'testing' && (
          <StatusBadge
            status={connectionMessage}
            variant={connectionStatus === 'success' ? 'success' : 'error'}
          />
        )}
      </div>
    </div>
  );
}
